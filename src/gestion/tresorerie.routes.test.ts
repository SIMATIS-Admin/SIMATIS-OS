import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';
import { ajouterMois, type Projection } from './tresorerie.js';
import type { SuiviTva } from './tva.js';

describe('Routes Gestion — trésorerie, réglages et TVA', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  const base = '/api/i/tre-propre/gestion';

  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    await createInstance(t.owner.db, {
      slug: 'tre-propre',
      nom: 'Mon activité',
      type: 'propre',
      config: { modules: ['gestion'] },
    });
    await createInstance(t.owner.db, { slug: 'tre-mandat', nom: 'Mandat', type: 'mandat' });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const json = (method: 'POST' | 'PUT', url: string, payload: object) =>
    app.inject({ method, url: `${base}${url}`, payload });
  const projection = async (query = 'horizon=3') =>
    (await app.inject({ method: 'GET', url: `${base}/tresorerie?${query}` })).json<Projection>();
  const reglages = (r: object) =>
    json('PUT', '/reglages', {
      soldeCents: null,
      soldeDate: null,
      soldeSource: null,
      seuilMode: 'aucun',
      seuilCents: null,
      delaiPaiementJours: null,
      ...r,
    });

  it('refuse hors de « Mon activité » avec le module', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/i/tre-mandat/gestion/tresorerie?horizon=3',
    });
    expect(r.statusCode).toBe(403);
  });

  it('sans réglage : pas de solde inventé, pas d’alerte, avertissements visibles', async () => {
    const p = await projection();
    expect(p.reglages).toMatchObject({
      soldeCents: null,
      seuilMode: 'aucun',
      delaiPaiementJours: null,
    });
    expect(p.scenarios).toHaveLength(3);
    expect(p.scenarios[0]!.periodes[0]!.soldeFinCents).toBeNull();
    expect(p.scenarios.every((s) => s.alerte === null)).toBe(true);
    expect(p.avertissements.join(' ')).toContain("Solde d'ouverture non renseigné");
  });

  it('exige une date et une source avec le solde, et un montant pour le seuil en montant', async () => {
    expect((await reglages({ soldeCents: 100_000 })).statusCode).toBe(400);
    expect((await reglages({ soldeDate: '2026-10-31', soldeSource: 'x' })).statusCode).toBe(400);
    expect((await reglages({ seuilMode: 'montant' })).statusCode).toBe(400);
    expect((await reglages({ delaiPaiementJours: 400 })).statusCode).toBe(400);
  });

  const plusJours = (jour: string, n: number) => {
    const d = new Date(`${jour}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  it('projette le solde, ne compte pas le loyer crédité à l’associé, et sépare les scénarios', async () => {
    expect(
      (
        await reglages({
          soldeCents: 1_000_000,
          soldeDate: '2000-01-01',
          soldeSource: 'relevé fictif',
          seuilMode: 'montant',
          seuilCents: 500_000,
          delaiPaiementJours: 30,
        })
      ).statusCode,
    ).toBe(200);
    const aujourdhui = (await projection()).aujourdhui;
    // Dépense mensuelle de la société : sort du compte. Loyer à l'associé : ne sort pas.
    await json('POST', '/depenses', {
      libelle: 'Outil fictif',
      montantTtcCents: 100_000,
      statut: 'prevue',
      recurrence: 'mensuelle',
      dateDebut: ajouterMois(aujourdhui, 1),
    });
    await json('POST', '/depenses', {
      libelle: 'Loyer fictif',
      montantTtcCents: 40_000,
      statut: 'prevue',
      recurrence: 'mensuelle',
      dateDebut: ajouterMois(aujourdhui, 1),
      payeur: 'associe',
    });
    await json('POST', '/revenus', {
      libelle: 'Commission certaine',
      montantHtCents: 300_000,
      tvaCents: 60_000,
      date: ajouterMois(aujourdhui, 2),
    });
    await json('POST', '/revenus', {
      libelle: 'Commission hypothèse',
      montantHtCents: 900_000,
      date: ajouterMois(aujourdhui, 2),
      certitude: 'hypothese',
    });
    const p = await projection('horizon=24');
    const [securise, , ambitieux] = p.scenarios;
    const total = (s: typeof securise) =>
      s!.periodes
        .flatMap((x) => x.mouvements)
        .reduce((t2, m) => t2 + (m.sens === 'entree' ? m.montantCents : 0), 0);
    expect(total(securise)).toBe(360_000);
    expect(total(ambitieux)).toBe(360_000 + 900_000);
    const sorties = securise!.periodes
      .flatMap((x) => x.mouvements)
      .filter((m) => m.sens === 'sortie');
    expect(sorties.length).toBeGreaterThan(0);
    expect(sorties.every((m) => m.libelle === 'Outil fictif')).toBe(true);
    expect(securise!.periodes.at(-1)!.soldeFinCents).not.toBeNull();
  });

  it('simule un retard de paiement sans modifier la facture de référence', async () => {
    const date = async (q: string) =>
      (await projection(q)).scenarios[0]!.periodes.flatMap((x) => x.mouvements).find(
        (m) => m.libelle === 'Commission certaine',
      )!.date;
    const facture = ajouterMois((await projection()).aujourdhui, 2);
    expect(await date('horizon=24')).toBe(plusJours(facture, 30));
    expect(await date('horizon=24&retard=30')).toBe(plusJours(facture, 60));
    expect(await date('horizon=24')).toBe(plusJours(facture, 30));
  });

  it('calcule le BFR strictement et en tire le seuil, ou prend le montant choisi', async () => {
    await json('POST', '/revenus', {
      libelle: 'Facture émise fictive',
      montantHtCents: 200_000,
      date: '2000-02-01',
      etat: 'emise',
    });
    await reglages({
      soldeCents: 1_000_000,
      soldeDate: '2000-01-01',
      soldeSource: 'relevé fictif',
      seuilMode: 'bfr',
      delaiPaiementJours: 30,
    });
    const p = await projection('horizon=1');
    expect(p.seuil.mode).toBe('bfr');
    expect(p.seuil.bfr).toMatchObject({ creancesCents: 200_000 });
    expect(p.seuil.cents).toBe(Math.max(0, p.seuil.bfr!.bfrCents));
    expect(p.seuil.bfr!.limites.join(' ')).toContain('TVA');
    await reglages({
      soldeCents: 1_000_000,
      soldeDate: '2000-01-01',
      soldeSource: 'relevé fictif',
      seuilMode: 'montant',
      seuilCents: 123_000,
    });
    expect((await projection('horizon=1')).seuil).toMatchObject({
      mode: 'montant',
      cents: 123_000,
      bfr: null,
    });
  });

  it('déclenche l’alerte quand le solde passe sous le seuil', async () => {
    await reglages({
      soldeCents: 50_000,
      soldeDate: '2000-01-01',
      soldeSource: 'relevé fictif',
      seuilMode: 'montant',
      seuilCents: 400_000,
    });
    const p = await projection('horizon=1');
    expect(p.scenarios[0]!.alerte).not.toBeNull();
  });

  it('suit la TVA : déclaration mensuelle, exigibilité à confirmer, lignes sans TVA signalées', async () => {
    await json('POST', '/depenses', {
      libelle: 'Achat avec TVA',
      montantTtcCents: 12_000,
      tvaCents: 2_000,
      statut: 'reelle',
      dateDebut: '2091-03-04',
    });
    await json('POST', '/depenses', {
      libelle: 'Achat sans TVA',
      montantTtcCents: 5_000,
      statut: 'reelle',
      dateDebut: '2091-03-05',
    });
    await json('POST', '/revenus', {
      libelle: 'Vente fictive',
      montantHtCents: 100_000,
      tvaCents: 20_000,
      date: '2091-03-10',
    });
    const r = await app.inject({ method: 'GET', url: `${base}/tva?mois=2091-03` });
    const v = r.json<SuiviTva>();
    expect(v).toMatchObject({
      declaration: 'mensuelle',
      exigibilite: 'a_confirmer',
      collecteeCents: 20_000,
      deductibleCents: 2_000,
      estimeeCents: 18_000,
      // L'achat sans TVA et l'outil récurrent des tests précédents.
      lignesSansTva: { recettes: 0, depenses: 2 },
      declaree: null,
    });
    expect(v.avertissements.join(' ')).toContain('Exigibilité à confirmer');
    const saisie = await json('PUT', '/tva/2091-03', {
      declareeCents: 17_500,
      note: 'saisie manuelle',
    });
    expect(saisie.json<SuiviTva>().declaree).toEqual({
      montantCents: 17_500,
      note: 'saisie manuelle',
    });
    expect((await json('PUT', '/tva/2091-13', { declareeCents: 1, note: null })).statusCode).toBe(
      400,
    );
  });
});
