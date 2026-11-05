import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import {
  assemblerFactures,
  dateEmissionPrevue,
  facturesParMandat,
  type IkRefacturable,
} from './factures.js';
import { creerBareme, creerTrajet, creerVehicule, trajetSchema, validerBareme } from './ik.js';
import { creerRevenu, revenuSchema, type OccurrenceRevenu } from './revenus.js';

// Données fictives : aucun client, montant ni taux réels.
const recette = (o: Partial<OccurrenceRevenu> = {}): OccurrenceRevenu => ({
  revenuId: 'r1',
  cle: 'r1|2026-11-10',
  libelle: 'Recette fictive',
  type: 'commission',
  mandat: 'mandat-a',
  certitude: 'certaine',
  date: '2026-11-10',
  dateEncaissement: null,
  montantHtCents: 100_000,
  etat: 'prevue',
  referenceFacture: null,
  recurrente: false,
  depenseId: null,
  tvaCents: null,
  ...o,
});
const ik = (o: Partial<IkRefacturable> = {}): IkRefacturable => ({
  trajetId: 't1',
  mandat: 'mandat-a',
  date: '2026-11-05',
  libelle: 'Trajet fictif',
  indemniteCents: 4_000,
  ...o,
});
const base = {
  recettes: [] as OccurrenceRevenu[],
  ik: [] as IkRefacturable[],
  delaisMandat: new Map<string, number | null>(),
  delaiGeneral: 30 as number | null,
  aujourdhui: '2026-11-12',
};

describe('dateEmissionPrevue', () => {
  it('est le dernier jour du mois, même ce jour-là', () => {
    expect(dateEmissionPrevue('2026-11-12')).toBe('2026-11-30');
    expect(dateEmissionPrevue('2026-11-30')).toBe('2026-11-30');
    expect(dateEmissionPrevue('2026-02-10')).toBe('2026-02-28');
  });
});

describe('assemblerFactures', () => {
  it('range les recettes par sorte', () => {
    const r = assemblerFactures({
      ...base,
      recettes: [
        recette({ revenuId: 'a', cle: 'a|d', type: 'abonnement', tvaCents: 0 }),
        recette({ revenuId: 'b', cle: 'b|d', type: 'commission' }),
        recette({ revenuId: 'c', cle: 'c|d', type: 'autre' }),
        recette({ revenuId: 'd', cle: 'd|d', type: 'refacturation', tvaCents: 0 }),
      ],
    });
    const sortes = Object.fromEntries(r.factures[0]!.lignes.map((l) => [l.cle, l.sorte]));
    expect(sortes).toEqual({
      'revenu:a|d': 'recurrent',
      'revenu:b|d': 'commission',
      'revenu:c|d': 'commission',
      'revenu:d|d': 'frais',
    });
  });

  it('exclut ce qui n’est pas prévu, les hypothèses et ce qui dépasse la date d’émission', () => {
    const r = assemblerFactures({
      ...base,
      recettes: [
        recette({ cle: 'ok|1' }),
        recette({ cle: 'emise|1', etat: 'emise' }),
        recette({ cle: 'enc|1', etat: 'encaissee' }),
        recette({ cle: 'ign|1', etat: 'ignoree' }),
        recette({ cle: 'hyp|1', certitude: 'hypothese' }),
        recette({ cle: 'tard|1', date: '2026-12-01' }),
      ],
    });
    expect(r.factures[0]!.lignes.map((l) => l.cle)).toEqual(['revenu:ok|1']);
  });

  it('regroupe par mandat, additionne le total hors taxes et trie les mandats', () => {
    const r = assemblerFactures({
      ...base,
      recettes: [
        recette({ cle: 'x|1', mandat: 'mandat-b', montantHtCents: 5_000 }),
        recette({ cle: 'y|1', mandat: 'mandat-a', montantHtCents: 10_000 }),
        recette({ cle: 'z|1', mandat: 'mandat-a', montantHtCents: 2_500 }),
      ],
    });
    expect(r.factures.map((f) => [f.mandat, f.totalHtCents])).toEqual([
      ['mandat-a', 12_500],
      ['mandat-b', 5_000],
    ]);
  });

  it('met les recettes sans mandat à part', () => {
    const r = assemblerFactures({ ...base, recettes: [recette({ mandat: null })] });
    expect(r.factures).toEqual([]);
    expect(r.sansMandat).toHaveLength(1);
  });

  it('situe l’encaissement : délai du mandat, sinon délai général, sinon inconnu', () => {
    const un = (delaisMandat: Map<string, number | null>, delaiGeneral: number | null) =>
      assemblerFactures({ ...base, recettes: [recette()], delaisMandat, delaiGeneral })
        .factures[0]!;
    expect(un(new Map([['mandat-a', 45]]), 30)).toMatchObject({
      emissionPrevue: '2026-11-30',
      delaiJours: 45,
      encaissementAttendu: '2027-01-14',
    });
    expect(un(new Map(), 30)).toMatchObject({ delaiJours: 30, encaissementAttendu: '2026-12-30' });
    const inconnu = un(new Map([['mandat-a', null]]), null);
    expect(inconnu.encaissementAttendu).toBeNull();
    expect(inconnu.avertissements.join(' ')).toMatch(/délai de paiement/i);
  });

  it('signale les frais dont la TVA est inconnue, sans perdre le montant', () => {
    const [l] = assemblerFactures({
      ...base,
      recettes: [recette({ type: 'refacturation', tvaCents: null })],
    }).factures[0]!.lignes;
    expect(l).toMatchObject({ sorte: 'frais', montantHtCents: 100_000 });
    expect(l!.avertissement).toBe('TVA à renseigner');
  });

  it('ajoute les trajets IK au montant du barème', () => {
    const f = assemblerFactures({ ...base, ik: [ik()] }).factures[0]!;
    expect(f.lignes[0]).toMatchObject({ cle: 'ik:t1', sorte: 'ik', montantHtCents: 4_000 });
    expect(f.totalHtCents).toBe(4_000);
  });

  it('un trajet sans barème a un montant inconnu, signalé, hors du total', () => {
    const f = assemblerFactures({
      ...base,
      recettes: [recette({ montantHtCents: 1_000 })],
      ik: [ik({ indemniteCents: null })],
    }).factures[0]!;
    const l = f.lignes.find((x) => x.sorte === 'ik')!;
    expect(l.montantHtCents).toBeNull();
    expect(l.avertissement).toMatch(/barème/i);
    expect(f.totalHtCents).toBe(1_000);
  });

  it('un mandat qui n’a que des IK sans barème a un total de 0, sans erreur', () => {
    const f = assemblerFactures({ ...base, ik: [ik({ indemniteCents: null })] }).factures[0]!;
    expect(f.totalHtCents).toBe(0);
  });

  it('inclut les échéances du jour d’émission et trie les lignes par date', () => {
    const f = assemblerFactures({
      ...base,
      aujourdhui: '2026-11-30',
      recettes: [
        recette({ cle: 'b|1', date: '2026-11-30' }),
        recette({ cle: 'a|1', date: '2026-11-03' }),
      ],
    }).factures[0]!;
    expect(f.lignes.map((l) => l.cle)).toEqual(['revenu:a|1', 'revenu:b|1']);
  });
});

describe('facturesParMandat', () => {
  let t: TestApp;
  let inst = '';
  beforeAll(async () => {
    t = await setupTestApp();
    inst = (
      await createInstance(t.owner.db, {
        slug: 'fac-propre',
        nom: 'Mon activité',
        type: 'propre',
        config: { modules: ['gestion'] },
      })
    ).id;
    await withInstance(t.app.db, inst, async (tx) => {
      const v = await creerVehicule(tx, inst, { libelle: 'Voiture', categorie: 'auto' });
      const b = await creerBareme(tx, inst, {
        annee: 2026,
        categorie: 'auto',
        source: 'Barème fictif de test',
        tranches: [{ deKm: 0, jusquaKm: null, tauxDixMilliemes: 5000, forfaitCents: 0 }],
      });
      await validerBareme(tx, b.id, '2026-11-03');
      const trajet = (date: string, nom: string, extra: object) =>
        creerTrajet(
          tx,
          inst,
          trajetSchema.parse({
            vehiculeId: v.id,
            date,
            trajet: nom,
            commentaire: 'Réunion fictive',
            kmAllerRetour: 40,
            ...extra,
          }),
        );
      await trajet('2026-11-05', 'Refacturé', { mandat: 'fac-a', refacturer: true });
      await trajet('2026-11-06', 'Non refacturé', { mandat: 'fac-a' });
      await trajet('2026-12-02', 'Trop tard', { mandat: 'fac-a', refacturer: true });
      const revenu = (o: object) =>
        creerRevenu(
          tx,
          inst,
          revenuSchema.parse({ libelle: 'Recette fictive', montantHtCents: 10_000, ...o }),
        );
      await revenu({ type: 'refacturation', mandat: 'fac-a', date: '2026-11-10' });
      await revenu({ mandat: null, date: '2026-11-11', libelle: 'Orpheline' });
    });
  });
  afterAll(async () => {
    await t.drop();
  });

  it('réunit recettes et trajets refacturés d’un mandat, et isole les recettes sans mandat', async () => {
    const r = await withInstance(t.app.db, inst, (tx) => facturesParMandat(tx, '2026-11-12'));
    expect(r.factures).toHaveLength(1);
    const f = r.factures[0]!;
    expect(f.mandat).toBe('fac-a');
    expect(f.lignes.map((l) => l.sorte).sort()).toEqual(['frais', 'ik']);
    // 40 km × 0,50 € = 20 €, plus 100 € de frais.
    expect(f.totalHtCents).toBe(2_000 + 10_000);
    expect(r.sansMandat.map((l) => l.libelle)).toEqual(['Orpheline']);
  });
});
