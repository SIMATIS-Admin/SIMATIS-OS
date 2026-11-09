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

  describe('rémunération', () => {
    const sortiesSalaire = (p: Projection) =>
      p.scenarios[1]!.periodes.flatMap((x) => x.mouvements).filter((m) =>
        m.ref.startsWith('remuneration:'),
      );
    const salaire = {
      actif: true,
      base: 'brut',
      montantCents: 400_000,
      tauxSalarial: 20,
      tauxPatronal: 40,
      periodicite: 'mensuelle',
    };

    it('sans réglage, aucune rémunération n’est projetée', async () => {
      await reglages({});
      const p = await projection('horizon=6');
      expect(p.remuneration).toBeNull();
      expect(sortiesSalaire(p)).toHaveLength(0);
    });

    it('projette le net et les cotisations, et se retire avec remuneration=0', async () => {
      await reglages({ remuneration: salaire });
      const p = await projection('horizon=6');
      expect(p.remuneration).toMatchObject({
        brutCents: 400_000,
        netCents: 320_000,
        urssafCents: 240_000,
        coutCents: 560_000,
        inclus: true,
      });
      const m = sortiesSalaire(p);
      expect(
        m
          .filter((x) => x.ref.startsWith('remuneration:net'))
          .every((x) => x.montantCents === 320_000),
      ).toBe(true);
      expect(
        m.some((x) => x.ref.startsWith('remuneration:urssaf') && x.montantCents === 240_000),
      ).toBe(true);
      // Les trois scénarios portent la même rémunération.
      expect(
        p.scenarios[0]!.periodes.flatMap((x) => x.mouvements).some((x) =>
          x.ref.startsWith('remuneration:'),
        ),
      ).toBe(true);
      const sans = await projection('horizon=6&remuneration=0');
      expect(sortiesSalaire(sans)).toHaveLength(0);
      expect(sans.remuneration).toMatchObject({ inclus: false });
      await reglages({});
    });

    it('refuse une rémunération incohérente', async () => {
      expect((await reglages({ remuneration: { ...salaire, tauxSalarial: 120 } })).statusCode).toBe(
        400,
      );
      expect((await reglages({ remuneration: { ...salaire, montantCents: 0 } })).statusCode).toBe(
        400,
      );
      expect((await reglages({ remuneration: { ...salaire, base: 'autre' } })).statusCode).toBe(
        400,
      );
    });
  });

  describe('pipe', () => {
    let idOk = '';
    let idSansDate = '';
    const pipeDe = (p: Projection, scenario: number) =>
      p.scenarios[scenario]!.periodes.flatMap((x) => x.mouvements).filter((m) =>
        m.ref.startsWith('pipe:'),
      );
    const somme = (m: { montantCents: number }[]) => m.reduce((t2, x) => t2 + x.montantCents, 0);

    beforeAll(async () => {
      const inst = (
        await t.owner.pool.query<{ id: string }>(
          "select id from instances where slug = 'tre-propre'",
        )
      ).rows[0]!.id;
      const aujourdhui = (await projection()).aujourdhui;
      const insere = async (titre: string, signature: string | null) =>
        (
          await t.owner.pool.query<{ id: string }>(
            `insert into opportunites (instance_id, titre, etape, montant, probabilite_manuelle, signature_estimee)
             values ($1, $2, 'proposition', 10000, 60, $3) returning id`,
            [inst, titre, signature],
          )
        ).rows[0]!.id;
      idOk = await insere('Affaire pipe fictive', ajouterMois(aujourdhui, 2));
      idSansDate = await insere('Affaire sans date fictive', null);
    });

    it('le central inclut le pipe pondéré, l’ambitieux à 100 %, le sécurisé rien', async () => {
      const p = await projection('horizon=12');
      expect(pipeDe(p, 0)).toHaveLength(0);
      expect(somme(pipeDe(p, 1))).toBe(600_000);
      expect(somme(pipeDe(p, 2))).toBe(1_000_000);
    });

    it('liste les affaires avec leur statut et avertit de celles qui sont écartées', async () => {
      const p = (await projection('horizon=12')) as Projection & {
        pipe: { affaires: { id: string; statut: string }[]; decalageMois: number };
      };
      expect(p.pipe.affaires.find((a) => a.id === idOk)?.statut).toBe('comptee');
      expect(p.pipe.affaires.find((a) => a.id === idSansDate)?.statut).toBe('sans_date');
      expect(p.avertissements.join(' ')).toContain('pipe');
    });

    it('décale l’encaissement avec decalage, et le retire avec exclus', async () => {
      const premiere = async (q: string) => pipeDe(await projection(q), 1)[0]?.date;
      const d0 = (await premiere('horizon=12'))!;
      const d3 = (await premiere('horizon=12&decalage=3'))!;
      const jours = (new Date(d3).getTime() - new Date(d0).getTime()) / 86_400_000;
      expect(jours).toBeGreaterThan(80);
      expect(jours).toBeLessThan(100);
      expect(await premiere(`horizon=12&exclus=${idOk}`)).toBeUndefined();
    });

    it('pipe=0 retire le pipe de tous les scénarios', async () => {
      expect(pipeDe(await projection('horizon=12&pipe=0'), 1)).toHaveLength(0);
      expect(pipeDe(await projection('horizon=12&pipe=0'), 2)).toHaveLength(0);
    });

    it('chaque scénario suit son propre réglage de pipe, enregistré avec les réglages', async () => {
      const r = await reglages({
        scenarios: {
          securise: { certitudes: ['certaine'], pipe: 'total' },
          central: { certitudes: ['certaine', 'probable'], pipe: 'total' },
          ambitieux: { certitudes: ['certaine'], pipe: 'pondere' },
        },
      });
      expect(r.statusCode).toBe(200);
      const p = await projection('horizon=12');
      expect(somme(pipeDe(p, 0))).toBe(1_000_000);
      expect(somme(pipeDe(p, 1))).toBe(1_000_000);
      expect(somme(pipeDe(p, 2))).toBe(600_000);
      expect(p.reglages.scenarios.ambitieux.pipe).toBe('pondere');
      await reglages({});
      expect(somme(pipeDe(await projection('horizon=12'), 1))).toBe(600_000);
    });

    it('hyp règle montant et probabilité d’une affaire, sans rien écrire en base', async () => {
      const p = (await projection(`horizon=12&hyp=${idOk}:20000:25`)) as Projection & {
        pipe: { affaires: { id: string; surcharge: boolean }[] };
      };
      expect(somme(pipeDe(p, 1))).toBe(500_000);
      expect(p.pipe.affaires.find((a) => a.id === idOk)?.surcharge).toBe(true);
      expect(somme(pipeDe(await projection('horizon=12'), 1))).toBe(600_000);
      const [l] = (
        await t.owner.pool.query<{ montant: number }>(
          'select montant from opportunites where id = $1',
          [idOk],
        )
      ).rows;
      expect(l!.montant).toBe(10_000);
    });

    it('refuse une hypothèse mal formée ou une probabilité au-delà de 100', async () => {
      const code = async (q: string) =>
        (await app.inject({ method: 'GET', url: `${base}/tresorerie?${q}` })).statusCode;
      expect(await code('horizon=3&hyp=pas-un-uuid:1:1')).toBe(400);
      expect(await code(`horizon=3&hyp=${idOk}:100:150`)).toBe(400);
      expect(await code(`horizon=3&hyp=${idOk}::40`)).toBe(200);
    });

    it('refuse un décalage hors limites ou une liste d’exclus mal formée', async () => {
      const code = async (q: string) =>
        (await app.inject({ method: 'GET', url: `${base}/tresorerie?${q}` })).statusCode;
      expect(await code('horizon=3&decalage=9')).toBe(400);
      expect(await code('horizon=3&exclus=pas-un-uuid')).toBe(400);
    });
  });
});
