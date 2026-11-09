import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { ClientAnnuaire, EntrepriseAnnuaire } from '../annuaire/client.js';
import { CRITERES_VIDES } from '../annuaire/criteres.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { integrerFiches } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import { registerBaseVivanteRoutes } from './routes.js';

const entreprise = (siren: string, nom: string): EntrepriseAnnuaire => ({
  siren,
  nom,
  formeJuridique: '5710',
  naf: '25.62B',
  categorie: 'PME',
  effectif: '20 à 49 salariés',
  creeLe: '1996-03-01',
  active: true,
  etablissementsOuverts: 1,
  oppositionDiffusion: false,
  siret: `${siren}00011`,
  adresse: '30 RUE DES TESTS 69680 CHASSIEU',
  codePostal: '69680',
  ville: 'CHASSIEU',
  departement: '69',
  latitude: null,
  longitude: null,
  finances: [],
  dirigeants: [],
});
const ATELIER = entreprise('123456789', 'ATELIER FICTIF');
const BUREAU = entreprise('222222222', 'BUREAU FICTIF');
const USINE = entreprise('333333333', 'USINE FICTIVE');

describe('base vivante : recherche d’entreprises dans l’annuaire', () => {
  let t: TestApp;
  let base: Instance;
  const annuaire = {
    chercher: vi.fn<ClientAnnuaire['chercher']>(),
    parSiren: vi.fn<ClientAnnuaire['parSiren']>(),
    rechercher: vi.fn<ClientAnnuaire['rechercher']>(),
  };

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-re', nom: 'Base', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    const parSiren: Record<string, EntrepriseAnnuaire> = {
      '123456789': ATELIER,
      '222222222': BUREAU,
      '333333333': USINE,
    };
    annuaire.parSiren.mockReset().mockImplementation((s) => Promise.resolve(parSiren[s] ?? null));
    annuaire.rechercher.mockReset().mockResolvedValue({
      resultats: [ATELIER, BUREAU],
      total: 2,
      pages: 1,
      page: 1,
    });
    for (const table of ['base_liste_fiches', 'base_listes', 'base_vivante', 'base_entreprises'])
      await t.owner.pool.query(`delete from ${table}`);
  });

  const app = () => {
    const a = Fastify();
    registerBaseVivanteRoutes(a, { db: t.app.db, annuaire });
    return a;
  };
  const post = (a: ReturnType<typeof app>, url: string, payload: unknown) =>
    a.inject({ method: 'POST', url: `/api/i/bv-re/base${url}`, payload: payload as object });
  const integrer = async (...brutes: Brut[]) => {
    const res = await withInstance(t.app.db, base.id, (tx) =>
      integrerFiches(
        tx,
        base.id,
        brutes.map((b) => ({
          fiche: normaliserFiche(b).fiche,
          provenance: 'Sharp',
          mandat: null,
          importId: null,
          collecteLe: null,
        })),
      ),
    );
    return res.map((r) => r.id);
  };
  const fiches = async () =>
    (
      await t.owner.pool.query<{
        entreprise: string;
        nom: string;
        zone: string;
        provenance: string;
        entreprise_id: string | null;
      }>(
        'select entreprise, nom, zone, provenance, entreprise_id from base_vivante order by entreprise, nom',
      )
    ).rows;

  it('cherche dans l’annuaire et marque les entreprises déjà dans la base', async () => {
    const a = app();
    await post(a, '/entreprises/ajouter', { sirens: ['123456789'] });
    const res = await post(a, '/entreprises/recherche', {
      criteres: { ...CRITERES_VIDES, departements: ['69'] },
      page: 2,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      total: 2,
      pages: 1,
      resultats: [{ siren: '123456789', nom: 'ATELIER FICTIF' }, { siren: '222222222' }],
      dejaDansLaBase: ['123456789'],
    });
    expect(annuaire.rechercher).toHaveBeenCalledWith(
      expect.objectContaining({ departements: ['69'] }),
      2,
    );
  });

  it('refuse une recherche sans critère ou avec un critère invalide', async () => {
    const a = app();
    annuaire.rechercher.mockRejectedValueOnce(new Error('ne devrait pas servir'));
    const vide = await post(a, '/entreprises/recherche', { criteres: CRITERES_VIDES });
    expect(vide.statusCode).toBe(400);
    expect(vide.json<{ error: string }>().error).toMatch(/critère/);
    expect(annuaire.rechercher).not.toHaveBeenCalled();
    expect((await post(a, '/entreprises/recherche', { criteres: 'x' })).statusCode).toBe(400);
  });

  it('ajoute les entreprises choisies à la base, à enrichir et rattachées à l’annuaire', async () => {
    const res = await post(app(), '/entreprises/ajouter', { sirens: ['123456789', '222222222'] });
    expect(res.json()).toEqual({ ajoutees: 2, existantes: 0, introuvables: 0 });
    expect(await fiches()).toMatchObject([
      {
        entreprise: 'ATELIER FICTIF',
        nom: '',
        zone: 'a_enrichir',
        provenance: 'Recherche d’entreprises',
      },
      { entreprise: 'BUREAU FICTIF', nom: '', zone: 'a_enrichir' },
    ]);
    const { rows } = await t.owner.pool.query<{ n: number }>(
      'select count(*)::int as n from base_vivante where entreprise_id is not null',
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('rattache les contacts déjà connus au lieu de créer une fiche en double', async () => {
    await integrer({ entreprise: 'Atelier Fictif', nom: 'Un', email: 'un@atelier-fictif.test' });
    const res = await post(app(), '/entreprises/ajouter', { sirens: ['123456789'] });
    expect(res.json()).toEqual({ ajoutees: 0, existantes: 1, introuvables: 0 });
    const lignes = await fiches();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.entreprise_id).toBeTruthy();
  });

  it('ne duplique rien quand on ajoute deux fois la même entreprise', async () => {
    const a = app();
    await post(a, '/entreprises/ajouter', { sirens: ['123456789'] });
    const encore = await post(a, '/entreprises/ajouter', { sirens: ['123456789', '123456789'] });
    expect(encore.json()).toEqual({ ajoutees: 0, existantes: 1, introuvables: 0 });
    expect(await fiches()).toHaveLength(1);
  });

  it('compte les SIREN introuvables et refuse les SIREN invalides ou trop nombreux', async () => {
    const a = app();
    const res = await post(a, '/entreprises/ajouter', { sirens: ['123456789', '999999999'] });
    expect(res.json()).toEqual({ ajoutees: 1, existantes: 0, introuvables: 1 });
    expect((await post(a, '/entreprises/ajouter', { sirens: ['12'] })).statusCode).toBe(400);
    const trop = Array.from({ length: 26 }, (_, i) => String(100000000 + i));
    expect((await post(a, '/entreprises/ajouter', { sirens: trop })).statusCode).toBe(400);
    expect((await post(a, '/entreprises/ajouter', { sirens: [] })).statusCode).toBe(400);
  });

  it('range les entreprises ajoutées dans une liste', async () => {
    const a = app();
    const liste = await post(a, '/listes', { nom: 'Industrie Rhône' });
    const id = liste.json<{ id: string }>().id;
    await integrer({ entreprise: 'Usine Fictive', nom: 'Deux', email: 'd@usine.test' });
    const res = await post(a, '/entreprises/ajouter', {
      sirens: ['123456789', '333333333'],
      liste: id,
    });
    expect(res.json()).toMatchObject({ ajoutees: 1, existantes: 1 });
    const { rows } = await t.owner.pool.query<{ n: number }>(
      'select count(*)::int as n from base_liste_fiches',
    );
    expect(rows[0]?.n).toBe(2);
    expect(
      (
        await post(a, '/entreprises/ajouter', {
          sirens: ['222222222'],
          liste: '00000000-0000-4000-8000-000000000000',
        })
      ).statusCode,
    ).toBe(404);
  });
});
