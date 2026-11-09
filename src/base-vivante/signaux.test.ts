import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { EntrepriseAnnuaire } from '../annuaire/client.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ErreurBodacc, type AnnonceBrute, type ClientBodacc } from '../signaux/bodacc.js';
import { enregistrerEntreprise } from './entreprises.js';
import { registerBaseVivanteRoutes } from './routes.js';

type Json = Record<string, unknown>;

const entreprise = (siren: string, nom: string): EntrepriseAnnuaire => ({
  siren,
  nom,
  formeJuridique: null,
  naf: null,
  categorie: null,
  effectif: null,
  creeLe: null,
  active: true,
  etablissementsOuverts: null,
  oppositionDiffusion: false,
  siret: null,
  adresse: null,
  codePostal: null,
  ville: 'LYON',
  departement: '69',
  latitude: null,
  longitude: null,
  finances: [],
  dirigeants: [],
});

const annonce = (
  id: string,
  famille: string,
  date: string,
  extra: Partial<AnnonceBrute> = {},
): AnnonceBrute => ({
  id,
  dateparution: date,
  typeavis_lib: 'Avis initial',
  familleavis_lib: famille,
  tribunal: null,
  url_complete: `https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${id}`,
  jugement: null,
  acte: null,
  modificationsgenerales: null,
  radiationaurcs: null,
  ...extra,
});

describe('base vivante : signaux du BODACC', () => {
  let t: TestApp;
  let base: Instance;
  let autre: Instance;
  let ids: Record<string, string>;
  const annonces = vi.fn<ClientBodacc['annonces']>();

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-sg', nom: 'Base', type: 'propre' });
    autre = await createInstance(t.owner.db, { slug: 'bv-sg-b', nom: 'Autre', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    for (const table of ['base_signaux', 'base_vivante', 'base_entreprises'])
      await t.owner.pool.query(`delete from ${table}`);
    ids = await withInstance(t.app.db, base.id, async (tx) => ({
      a: (await enregistrerEntreprise(tx, base.id, entreprise('111111111', 'ATELIER'))).id,
      b: (await enregistrerEntreprise(tx, base.id, entreprise('222222222', 'BUREAU'))).id,
      c: (await enregistrerEntreprise(tx, base.id, entreprise('333333333', 'CHANTIER'))).id,
    }));
    annonces.mockReset().mockImplementation((siren) => {
      if (siren === '111111111')
        return Promise.resolve([
          annonce('A1', 'Procédures collectives', '2026-10-05', {
            jugement: JSON.stringify({ nature: 'Jugement d’ouverture de redressement judiciaire' }),
          }),
          annonce('A2', 'Modifications diverses', '2026-09-01', {
            modificationsgenerales: '{"descriptif":"Changement de gérant."}',
          }),
          annonce('A3', 'Annonces diverses', '2026-08-01'),
        ]);
      if (siren === '222222222')
        return Promise.resolve([
          annonce('B1', 'Ventes et cessions', '2026-10-20', {
            acte: JSON.stringify({ vente: { categorieVente: 'Cession de fonds' } }),
          }),
        ]);
      return Promise.resolve([]);
    });
  });

  const app = () => {
    const a = Fastify();
    registerBaseVivanteRoutes(a, { db: t.app.db, bodacc: { annonces } });
    return a;
  };
  const appel = async (method: 'GET' | 'POST', url: string, payload?: unknown, slug = 'bv-sg') => {
    const r = await app().inject({
      method,
      url: `/api/i/${slug}/base${url}`,
      payload: payload as Json,
    });
    return { status: r.statusCode, corps: r.json<Json>() };
  };

  it('range les annonces utiles d’une entreprise et ignore le reste', async () => {
    const r = await appel('POST', `/entreprises/${ids.a}/signaux/actualiser`);
    expect(r.status).toBe(200);
    expect(r.corps.nouveaux).toBe(2);
    expect(r.corps.signaux).toMatchObject([
      { famille: 'Procédure collective', gravite: 'alerte', date: '2026-10-05' },
      { famille: 'Modification', gravite: 'info', nature: 'Changement de gérant.' },
    ]);
    expect(r.corps.verifieLe).toEqual(expect.any(String));
  });

  it('ne duplique rien à la deuxième actualisation', async () => {
    await appel('POST', `/entreprises/${ids.a}/signaux/actualiser`);
    const encore = await appel('POST', `/entreprises/${ids.a}/signaux/actualiser`);
    expect(encore.corps.nouveaux).toBe(0);
    expect((encore.corps.signaux as unknown[]).length).toBe(2);
    expect(annonces.mock.calls[0]?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lit les signaux enregistrés, le plus grave d’abord', async () => {
    await appel('POST', `/entreprises/${ids.a}/signaux/actualiser`);
    const lu = await appel('GET', `/entreprises/${ids.a}/signaux`);
    expect((lu.corps.signaux as Json[]).map((s) => s.gravite)).toEqual(['alerte', 'info']);
    const jamais = await appel('GET', `/entreprises/${ids.c}/signaux`);
    expect(jamais.corps).toMatchObject({ signaux: [], verifieLe: null });
  });

  it('actualise plusieurs entreprises et compte celles que le BODACC n’a pas pu lire', async () => {
    annonces.mockImplementationOnce(() => Promise.reject(new ErreurBodacc('BODACC indisponible.')));
    const r = await appel('POST', '/entreprises/signaux/actualiser', {
      ids: [ids.a, ids.b, ids.c],
    });
    expect(r.status).toBe(200);
    expect(r.corps).toEqual({ verifiees: 2, nouveaux: 1, echecs: 1 });
  });

  it('résume le signal le plus grave dans la liste et filtre dessus', async () => {
    await appel('POST', '/entreprises/signaux/actualiser', { ids: [ids.a, ids.b, ids.c] });
    const liste = await appel('GET', '/entreprises');
    const lignes = liste.corps.entreprises as Json[];
    expect(lignes.find((l) => l.nom === 'ATELIER')?.signal).toMatchObject({
      gravite: 'alerte',
      nature: 'Jugement d’ouverture de redressement judiciaire',
    });
    expect(lignes.find((l) => l.nom === 'BUREAU')?.signal).toMatchObject({ gravite: 'attention' });
    expect(lignes.find((l) => l.nom === 'CHANTIER')).toMatchObject({ signal: null });
    expect((await appel('GET', '/entreprises?signal=alerte')).corps.total).toBe(1);
    expect((await appel('GET', '/entreprises?signal=attention')).corps.total).toBe(2);
    expect((await appel('GET', '/entreprises?signal=jamais')).corps.total).toBe(0);
  });

  it('signale une entreprise jamais vérifiée', async () => {
    await appel('POST', `/entreprises/${ids.a}/signaux/actualiser`);
    const lignes = (await appel('GET', '/entreprises?signal=jamais')).corps.entreprises as Json[];
    expect(lignes.map((l) => l.nom).sort()).toEqual(['BUREAU', 'CHANTIER']);
  });

  it('refuse une entreprise inconnue, des identifiants invalides ou trop nombreux, et une autre instance', async () => {
    expect(
      (await appel('POST', '/entreprises/00000000-0000-4000-8000-000000000000/signaux/actualiser'))
        .status,
    ).toBe(404);
    expect(
      (await appel('GET', '/entreprises/00000000-0000-4000-8000-000000000000/signaux')).status,
    ).toBe(404);
    expect((await appel('POST', '/entreprises/signaux/actualiser', { ids: [] })).status).toBe(400);
    expect((await appel('POST', '/entreprises/signaux/actualiser', { ids: ['x'] })).status).toBe(
      400,
    );
    const trop = Array.from({ length: 26 }, () => ids.a);
    expect((await appel('POST', '/entreprises/signaux/actualiser', { ids: trop })).status).toBe(
      400,
    );
    expect(
      (await appel('POST', `/entreprises/${ids.a}/signaux/actualiser`, undefined, 'bv-sg-b'))
        .status,
    ).toBe(404);
    await withInstance(t.app.db, autre.id, (tx) =>
      enregistrerEntreprise(tx, autre.id, entreprise('111111111', 'AUTRE')),
    );
    expect((await appel('GET', '/entreprises', undefined, 'bv-sg-b')).corps.total).toBe(1);
  });

  it('un BODACC en panne rend une erreur claire sans rien enregistrer', async () => {
    annonces.mockRejectedValueOnce(new ErreurBodacc('BODACC indisponible.'));
    const r = await appel('POST', `/entreprises/${ids.a}/signaux/actualiser`);
    expect(r.status).toBe(502);
    expect((await appel('GET', `/entreprises/${ids.a}/signaux`)).corps.signaux).toEqual([]);
  });
});
