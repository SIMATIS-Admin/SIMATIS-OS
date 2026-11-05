import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Feuille } from '../base-vivante/lecture.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { analyserImport, proposerRapprochements } from './import.js';
import type { LigneImport } from './import-pennylane.js';
import { creerRevenu, revenuSchema, type OccurrenceRevenu } from './revenus.js';
import { creerDepense, depenseSchema, type OccurrenceVue } from './service.js';

const ligne = (p: Partial<LigneImport> & { cle: string }): LigneImport => ({
  rang: 1,
  date: '2026-10-15',
  libelle: 'Libellé fictif',
  montantCents: -4900,
  compte: 'Compte fictif',
  ...p,
});
const dep = (p: Partial<OccurrenceVue> = {}): OccurrenceVue => ({
  depenseId: 'd1',
  cle: 'd1|2026-10-14',
  libelle: 'Abonnement fictif',
  categorie: null,
  date: '2026-10-14',
  montantTtcCents: 4900,
  etat: 'a_venir',
  statut: 'prevue',
  recurrente: true,
  payeur: 'societe',
  tvaCents: null,
  affectations: [],
  refacturable: false,
  justificatif: null,
  ...p,
});
const rec = (p: Partial<OccurrenceRevenu> = {}): OccurrenceRevenu => ({
  revenuId: 'r1',
  cle: 'r1|2026-09-15',
  libelle: 'Facture fictive',
  type: 'autre',
  mandat: null,
  certitude: 'certaine',
  date: '2026-09-15',
  dateEncaissement: null,
  montantHtCents: 50_000,
  etat: 'emise',
  referenceFacture: null,
  recurrente: false,
  depenseId: null,
  tvaCents: null,
  ...p,
});

describe('proposerRapprochements', () => {
  it('rapproche une sortie d’une occurrence à venir de même montant, à 7 jours au plus', () => {
    const r = proposerRapprochements([ligne({ cle: 'a' })], [dep()], []);
    expect(r.get('a')).toMatchObject({
      type: 'depense',
      id: 'd1',
      dateOrigine: '2026-10-14',
      montantCents: 4900,
    });
    const loin = proposerRapprochements([ligne({ cle: 'a', date: '2026-10-23' })], [dep()], []);
    expect(loin.size).toBe(0);
  });

  it('ne propose jamais une occurrence ignorée, payée ou avancée par l’associé', () => {
    for (const d of [dep({ etat: 'ignoree' }), dep({ etat: 'payee' }), dep({ payeur: 'associe' })])
      expect(proposerRapprochements([ligne({ cle: 'a' })], [d], []).size).toBe(0);
  });

  it('une cible n’est proposée qu’à la ligne la plus proche', () => {
    const r = proposerRapprochements(
      [
        ligne({ cle: 'loin', date: '2026-10-19' }),
        ligne({ cle: 'proche', date: '2026-10-15', rang: 2 }),
      ],
      [dep()],
      [],
    );
    expect([...r.keys()]).toEqual(['proche']);
  });

  it('rapproche une entrée d’une recette prévue ou facturée, TVA comprise, à 45 jours au plus', () => {
    const l = ligne({ cle: 'e', montantCents: 60_000, date: '2026-10-20' });
    expect(proposerRapprochements([l], [], [rec({ tvaCents: 10_000 })]).get('e')).toMatchObject({
      type: 'recette',
      id: 'r1',
      montantCents: 60_000,
    });
    expect(
      proposerRapprochements([l], [], [rec({ tvaCents: 10_000, date: '2026-08-01' })]).size,
    ).toBe(0);
    expect(
      proposerRapprochements([l], [], [rec({ tvaCents: 10_000, etat: 'encaissee' })]).size,
    ).toBe(0);
  });

  it('un montant différent n’est jamais rapproché', () => {
    expect(
      proposerRapprochements([ligne({ cle: 'a', montantCents: -4901 })], [dep()], []).size,
    ).toBe(0);
  });
});

describe('analyserImport', () => {
  let t: TestApp;
  let inst = '';
  beforeAll(async () => {
    t = await setupTestApp();
    inst = (
      await createInstance(t.owner.db, {
        slug: 'ana-propre',
        nom: 'Mon activité',
        type: 'propre',
        config: { modules: ['gestion'] },
      })
    ).id;
    await withInstance(t.app.db, inst, async (tx) => {
      await creerDepense(
        tx,
        inst,
        depenseSchema.parse({
          libelle: 'Abonnement fictif',
          montantTtcCents: 4900,
          statut: 'prevue',
          recurrence: 'mensuelle',
          dateDebut: '2026-09-14',
        }),
      );
      await creerRevenu(
        tx,
        inst,
        revenuSchema.parse({
          libelle: 'Facture fictive',
          montantHtCents: 50_000,
          etat: 'emise',
          date: '2026-10-01',
        }),
      );
    });
  });
  afterAll(async () => {
    await t.drop();
  });

  const f = (...l: string[][]): Feuille => ({
    nom: 'x',
    lignes: [['Date', 'Libellé', 'Montant'], ...l],
  });
  const analyser = (feuille: Feuille) =>
    withInstance(t.app.db, inst, (tx) => analyserImport(tx, feuille));

  it('classe nouvelle, à vérifier (rapprochement) et entrée sans cible, sans rien écrire', async () => {
    const feuille = f(
      ['2026-10-15', 'PRLV fictif A', '-49'],
      ['2026-10-16', 'Paiement fictif B', '-12,30'],
      ['2026-10-17', 'VIR fictif C', '200'],
    );
    const a = await analyser(feuille);
    const parLibelle = (n: string) => a.lignes.find((x) => x.libelle === n)!;
    expect(parLibelle('PRLV fictif A')).toMatchObject({ issue: 'a_verifier', sens: 'sortie' });
    expect(parLibelle('PRLV fictif A').rapprochement?.libelle).toBe('Abonnement fictif');
    expect(parLibelle('Paiement fictif B')).toMatchObject({
      issue: 'nouvelle',
      rapprochement: null,
    });
    expect(parLibelle('VIR fictif C')).toMatchObject({ issue: 'a_verifier', sens: 'entree' });
    expect(parLibelle('VIR fictif C').raison).toContain('Aucune recette prévue');
    expect(a.compteurs).toEqual({ nouvelles: 1, deja: 0, aVerifier: 2, nonFinalisees: 0 });
    const n = await t.owner.pool.query('select count(*)::int as n from gestion_import_cles');
    expect(n.rows[0].n).toBe(0);
  });

  it('une clé déjà au registre est « déjà importée »', async () => {
    const feuille = f(['2026-10-16', 'Paiement fictif B', '-12,30']);
    const [l] = (await analyser(feuille)).lignes;
    await t.owner.pool.query(
      `insert into gestion_import_cles (instance_id, cle, decision) values ($1, $2, 'importee')`,
      [inst, l!.cle],
    );
    const a = await analyser(feuille);
    expect(a.lignes[0]).toMatchObject({ issue: 'deja' });
    expect(a.compteurs).toMatchObject({ deja: 1, nouvelles: 0 });
  });
});

describe('Registre des lignes importées', () => {
  let t: TestApp;
  let a = '';
  let b = '';

  beforeAll(async () => {
    t = await setupTestApp();
    a = (
      await createInstance(t.owner.db, {
        slug: 'imp-a',
        nom: 'A',
        type: 'propre',
        config: { modules: ['gestion'] },
      })
    ).id;
    b = (
      await createInstance(t.owner.db, {
        slug: 'imp-b',
        nom: 'B',
        type: 'propre',
        config: { modules: ['gestion'] },
      })
    ).id;
  });
  afterAll(async () => {
    await t.drop();
  });

  const inserer = (instance: string, cle: string) =>
    t.owner.pool.query(
      `insert into gestion_import_cles (instance_id, cle, decision) values ($1, $2, 'importee')`,
      [instance, cle],
    );

  it('refuse deux fois la même clé dans la même instance', async () => {
    await inserer(a, 'pennylane|c|2026-10-15|-2399|x|1');
    await expect(inserer(a, 'pennylane|c|2026-10-15|-2399|x|1')).rejects.toThrow();
  });

  it('autorise la même clé dans une autre instance', async () => {
    await expect(inserer(b, 'pennylane|c|2026-10-15|-2399|x|1')).resolves.toBeTruthy();
  });
});
