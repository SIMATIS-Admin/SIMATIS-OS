import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { ClientAnnuaire, EntrepriseAnnuaire } from '../annuaire/client.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { integrerFiches } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import { registerBaseVivanteRoutes } from './routes.js';

const atelier: EntrepriseAnnuaire = {
  siren: '123456789',
  nom: 'ATELIER FICTIF',
  formeJuridique: '5710',
  naf: '25.62B',
  categorie: 'PME',
  effectif: '20 à 49 salariés',
  creeLe: '1996-03-01',
  active: true,
  etablissementsOuverts: 2,
  oppositionDiffusion: false,
  siret: '12345678900011',
  adresse: '30 RUE DES TESTS 69680 CHASSIEU',
  codePostal: '69680',
  ville: 'CHASSIEU',
  departement: '69',
  latitude: 45.7,
  longitude: 4.97,
  finances: [{ annee: 2022, ca: 425165, resultat: 9666 }],
  dirigeants: [{ nom: 'Jeanne DUPONT', fonction: 'Président', societe: false }],
};

describe('base vivante : entreprises de l’annuaire', () => {
  let t: TestApp;
  let base: Instance;
  let autre: Instance;
  const annuaire = {
    chercher: vi.fn<ClientAnnuaire['chercher']>(),
    parSiren: vi.fn<ClientAnnuaire['parSiren']>(),
    rechercher: vi.fn<ClientAnnuaire['rechercher']>(),
  };

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-ent', nom: 'Base', type: 'propre' });
    autre = await createInstance(t.owner.db, { slug: 'bv-ent-b', nom: 'Autre', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    annuaire.chercher.mockReset().mockResolvedValue([atelier]);
    annuaire.parSiren.mockReset().mockResolvedValue(atelier);
    for (const table of ['base_vivante', 'base_entreprises'])
      await t.owner.pool.query(`delete from ${table}`);
  });

  const integrer = async (instance: Instance, ...brutes: Brut[]) => {
    const res = await withInstance(t.app.db, instance.id, (tx) =>
      integrerFiches(
        tx,
        instance.id,
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
  const app = () => {
    const a = Fastify();
    registerBaseVivanteRoutes(a, { db: t.app.db, annuaire });
    return a;
  };
  const rattacher = (a: ReturnType<typeof app>, ficheId: string, siren: string, slug = 'bv-ent') =>
    a.inject({
      method: 'POST',
      url: `/api/i/${slug}/base/fiches/${ficheId}/entreprise`,
      payload: { siren },
    });

  it('propose les entreprises de l’annuaire qui ressemblent à la fiche', async () => {
    const [id] = await integrer(base, {
      entreprise: 'Atelier Fictif',
      nom: 'Un',
      email: 'un@a.test',
    });
    const res = await app().inject({
      method: 'GET',
      url: `/api/i/bv-ent/base/fiches/${id}/entreprise/candidats`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ candidats: EntrepriseAnnuaire[] }>().candidats[0]).toMatchObject({
      siren: '123456789',
      ville: 'CHASSIEU',
    });
    expect(annuaire.chercher).toHaveBeenCalledWith('Atelier Fictif', { limite: 5 });
  });

  it('cherche sous le nom seul quand la liste ajoute « — Ville (21) » au nom', async () => {
    const [id] = await integrer(base, {
      entreprise: 'Atelier Fictif — Dijon / Longvic (21)',
      nom: 'Un',
      email: 'un@a.test',
    });
    await app().inject({
      method: 'GET',
      url: `/api/i/bv-ent/base/fiches/${id}/entreprise/candidats`,
    });
    expect(annuaire.chercher).toHaveBeenCalledWith('Atelier Fictif', {
      limite: 5,
      departement: '21',
    });
  });

  it('rattache la fiche et les autres contacts de la même entreprise', async () => {
    const [un, deux, autreSociete] = await integrer(
      base,
      { entreprise: 'Atelier Fictif', nom: 'Un', email: 'un@a.test' },
      { entreprise: ' ATELIER fictif ', nom: 'Deux', email: 'deux@a.test' },
      { entreprise: 'Bureau Fictif', nom: 'Trois', email: 'trois@b.test' },
    );
    const res = await rattacher(app(), un ?? '', '123 456 789');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      entreprise: { siren: '123456789', nom: 'ATELIER FICTIF' },
      rattachees: 2,
    });
    const { rows } = await t.owner.pool.query<{ id: string; entreprise_id: string | null }>(
      'select id, entreprise_id from base_vivante order by nom',
    );
    const lien = (id?: string) => rows.find((r) => r.id === id)?.entreprise_id;
    expect(lien(un)).toBeTruthy();
    expect(lien(deux)).toBe(lien(un));
    expect(lien(autreSociete)).toBeNull();
  });

  it('enregistre l’entreprise une seule fois par SIREN et la met à jour', async () => {
    const [un, deux] = await integrer(
      base,
      { entreprise: 'Atelier Fictif', nom: 'Un', email: 'un@a.test' },
      { entreprise: 'Atelier Fictif Sud', nom: 'Deux', email: 'deux@a.test' },
    );
    const a = app();
    await rattacher(a, un ?? '', '123456789');
    annuaire.parSiren.mockResolvedValue({ ...atelier, effectif: '50 à 99 salariés' });
    await rattacher(a, deux ?? '', '123456789');
    const { rows } = await t.owner.pool.query('select effectif from base_entreprises');
    expect(rows).toEqual([{ effectif: '50 à 99 salariés' }]);
  });

  it('refuse un SIREN invalide ou inconnu, et un service indisponible', async () => {
    const [id] = await integrer(base, {
      entreprise: 'Atelier Fictif',
      nom: 'Un',
      email: 'un@a.test',
    });
    const a = app();
    expect((await rattacher(a, id ?? '', '12')).statusCode).toBe(400);
    annuaire.parSiren.mockResolvedValueOnce(null);
    expect((await rattacher(a, id ?? '', '999999999')).statusCode).toBe(404);
    expect(
      (await rattacher(a, '00000000-0000-4000-8000-000000000000', '123456789')).statusCode,
    ).toBe(404);
    const { rows } = await t.owner.pool.query<{ n: number }>(
      'select count(*)::int as n from base_entreprises',
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('lit la fiche entreprise et la détache d’un contact', async () => {
    const [id] = await integrer(base, {
      entreprise: 'Atelier Fictif',
      nom: 'Un',
      email: 'un@a.test',
    });
    const a = app();
    const { entreprise } = (await rattacher(a, id ?? '', '123456789')).json<{
      entreprise: { id: string };
    }>();
    const lue = await a.inject({
      method: 'GET',
      url: `/api/i/bv-ent/base/entreprises/${entreprise.id}`,
    });
    expect(lue.json()).toMatchObject({
      siren: '123456789',
      finances: [{ annee: 2022, ca: 425165, resultat: 9666 }],
      dirigeants: [{ nom: 'Jeanne DUPONT', fonction: 'Président', societe: false }],
    });
    const detache = await a.inject({
      method: 'DELETE',
      url: `/api/i/bv-ent/base/fiches/${id}/entreprise`,
    });
    expect(detache.statusCode).toBe(200);
    const { rows } = await t.owner.pool.query('select entreprise_id from base_vivante');
    expect(rows).toEqual([{ entreprise_id: null }]);
  });

  it('cloisonne les entreprises par instance', async () => {
    const [id] = await integrer(base, {
      entreprise: 'Atelier Fictif',
      nom: 'Un',
      email: 'un@a.test',
    });
    const a = app();
    const { entreprise } = (await rattacher(a, id ?? '', '123456789')).json<{
      entreprise: { id: string };
    }>();
    const vue = await a.inject({
      method: 'GET',
      url: `/api/i/bv-ent-b/base/entreprises/${entreprise.id}`,
    });
    expect(vue.statusCode).toBe(404);
    const [idAutre] = await integrer(autre, {
      entreprise: 'Atelier Fictif',
      nom: 'Un',
      email: 'un@a.test',
    });
    expect((await rattacher(a, idAutre ?? '', '123456789', 'bv-ent-b')).statusCode).toBe(200);
    const { rows } = await t.owner.pool.query<{ n: number }>(
      'select count(*)::int as n from base_entreprises',
    );
    expect(rows[0]?.n).toBe(2);
  });
});
