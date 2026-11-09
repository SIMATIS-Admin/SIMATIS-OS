import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { EntrepriseAnnuaire } from '../annuaire/client.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import type { Geocodeur } from '../routage/geocodage.js';
import { estimerTournee, type Routeur } from '../routage/osrm.js';
import { enregistrerEntreprise } from './entreprises.js';
import { integrerFiches, rattacherEntreprise } from './integration.js';
import { normaliserFiche } from './nettoyage.js';
import { registerBaseVivanteRoutes } from './routes.js';

type Json = Record<string, unknown>;

const entreprise = (
  siren: string,
  nom: string,
  latitude: number | null,
  longitude: number | null,
): EntrepriseAnnuaire => ({
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
  adresse: `1 RUE DE ${nom}`,
  codePostal: null,
  ville: 'LYON',
  departement: '69',
  latitude,
  longitude,
  finances: [],
  dirigeants: [],
});

describe('base vivante : carte et tournées', () => {
  let t: TestApp;
  let base: Instance;
  let autre: Instance;
  let ids: Record<string, string>;
  const tournee = vi.fn<Routeur['tournee']>();
  const geocodeur: Geocodeur = {
    adresse: vi.fn((texte: string) =>
      Promise.resolve(
        texte.includes('inconnue')
          ? null
          : { latitude: 45.75, longitude: 4.85, libelle: '5 Rue du Départ 69003 Lyon' },
      ),
    ),
  };

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-ca', nom: 'Base', type: 'propre' });
    autre = await createInstance(t.owner.db, { slug: 'bv-ca-b', nom: 'Autre', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    tournee.mockReset().mockImplementation((points) => Promise.resolve(estimerTournee(points)));
    for (const table of [
      'base_liste_entreprises',
      'base_listes',
      'base_vivante',
      'base_entreprises',
    ])
      await t.owner.pool.query(`delete from ${table}`);
    ids = await withInstance(t.app.db, base.id, async (tx) => {
      const a = await enregistrerEntreprise(
        tx,
        base.id,
        entreprise('111111111', 'ATELIER', 45.764, 4.8357),
      );
      const b = await enregistrerEntreprise(
        tx,
        base.id,
        entreprise('222222222', 'BUREAU', 45.7667, 4.8803),
      );
      const c = await enregistrerEntreprise(
        tx,
        base.id,
        entreprise('333333333', 'CHANTIER', 45.6976, 4.887),
      );
      const d = await enregistrerEntreprise(
        tx,
        base.id,
        entreprise('444444444', 'SANS GPS', null, null),
      );
      const [fiche] = await integrerFiches(tx, base.id, [
        {
          fiche: normaliserFiche({ entreprise: 'Atelier', nom: 'Un', email: 'un@a.test' }).fiche,
          provenance: 'Sharp',
          mandat: null,
          importId: null,
          collecteLe: null,
        },
      ]);
      await rattacherEntreprise(tx, base.id, fiche?.id ?? '', a.id);
      return { a: a.id, b: b.id, c: c.id, d: d.id };
    });
  });

  const app = () => {
    const a = Fastify();
    registerBaseVivanteRoutes(a, { db: t.app.db, routeur: { tournee }, geocodeur });
    return a;
  };
  const appel = async (method: 'GET' | 'POST', url: string, payload?: unknown, slug = 'bv-ca') => {
    const r = await app().inject({
      method,
      url: `/api/i/${slug}/base${url}`,
      payload: payload as Json,
    });
    return { status: r.statusCode, corps: r.json<Json>() };
  };

  it('donne les entreprises localisées et compte celles qui ne le sont pas', async () => {
    const { corps } = await appel('GET', '/entreprises/carte');
    expect(corps).toMatchObject({ total: 4, sansCoordonnees: 1 });
    const points = corps.points as Json[];
    expect(points).toHaveLength(3);
    expect(points.find((p) => p.nom === 'ATELIER')).toMatchObject({
      latitude: 45.764,
      longitude: 4.8357,
      nbContacts: 1,
    });
    expect(points.some((p) => p.nom === 'SANS GPS')).toBe(false);
    expect((await appel('GET', '/entreprises/carte?q=chantier')).corps).toMatchObject({ total: 1 });
  });

  it('la carte suit la liste d’entreprises choisie', async () => {
    const liste = await appel('POST', '/listes', { nom: 'Cibles', type: 'entreprises' });
    await appel('POST', `/listes/${liste.corps.id as string}/entreprises`, { ids: [ids.a, ids.c] });
    const { corps } = await appel('GET', `/entreprises/carte?liste=${liste.corps.id as string}`);
    expect((corps.points as Json[]).map((p) => p.nom).sort()).toEqual(['ATELIER', 'CHANTIER']);
  });

  it('calcule la tournée dans l’ordre rendu par le routeur, la première entreprise étant le départ', async () => {
    tournee.mockResolvedValueOnce({
      ordre: [0, 2, 1],
      etapes: [
        { distanceM: 11000, dureeS: 1100 },
        { distanceM: 5000, dureeS: 800 },
      ],
      distanceM: 16000,
      dureeS: 1900,
      trace: [[45.764, 4.8357]],
      source: 'routes',
    });
    const { status, corps } = await appel('POST', '/tournee', { ids: [ids.a, ids.b, ids.c] });
    expect(status).toBe(200);
    expect(corps).toMatchObject({ distanceM: 16000, dureeS: 1900, source: 'routes', ignorees: [] });
    expect((corps.etapes as Json[]).map((e) => [e.nom, e.distanceM])).toEqual([
      ['ATELIER', 0],
      ['CHANTIER', 11000],
      ['BUREAU', 5000],
    ]);
    expect(tournee.mock.calls[0]?.[0]).toEqual([
      { latitude: 45.764, longitude: 4.8357 },
      { latitude: 45.7667, longitude: 4.8803 },
      { latitude: 45.6976, longitude: 4.887 },
    ]);
  });

  it('part d’une adresse quand on en donne une, et la rend dans les étapes', async () => {
    const { corps } = await appel('POST', '/tournee', {
      ids: [ids.a, ids.b],
      depart: '5 rue du Départ Lyon',
    });
    const etapes = corps.etapes as Json[];
    expect(etapes[0]).toMatchObject({ id: null, nom: '5 Rue du Départ 69003 Lyon', distanceM: 0 });
    expect(etapes).toHaveLength(3);
    expect(tournee.mock.calls[0]?.[0][0]).toEqual({ latitude: 45.75, longitude: 4.85 });
  });

  it('écarte les entreprises sans coordonnées et le dit', async () => {
    const { corps } = await appel('POST', '/tournee', { ids: [ids.a, ids.d, ids.b] });
    expect(corps.ignorees).toEqual(['SANS GPS']);
    expect(corps.etapes).toHaveLength(2);
  });

  it('refuse une tournée impossible', async () => {
    expect((await appel('POST', '/tournee', { ids: [ids.a] })).status).toBe(400);
    expect((await appel('POST', '/tournee', { ids: [ids.a, ids.d] })).status).toBe(400);
    expect(
      (await appel('POST', '/tournee', { ids: [ids.a, ids.b], depart: 'adresse inconnue' })).status,
    ).toBe(400);
    const trop = Array.from({ length: 26 }, () => ids.a);
    expect((await appel('POST', '/tournee', { ids: trop })).status).toBe(400);
    expect((await appel('POST', '/tournee', { ids: ['pas-un-uuid', ids.a] })).status).toBe(400);
  });

  it('cloisonne les entreprises par instance', async () => {
    const autreId = await withInstance(
      t.app.db,
      autre.id,
      async (tx) =>
        (await enregistrerEntreprise(tx, autre.id, entreprise('555555555', 'AUTRE', 45.7, 4.8))).id,
    );
    expect((await appel('GET', '/entreprises/carte', undefined, 'bv-ca-b')).corps).toMatchObject({
      total: 1,
    });
    // Les entreprises d'une autre instance ne comptent pas : il reste une seule étape valable.
    expect((await appel('POST', '/tournee', { ids: [ids.a, autreId] })).status).toBe(400);
  });
});
