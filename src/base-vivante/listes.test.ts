import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { integrerFiches } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import { registerBaseVivanteRoutes } from './routes.js';
import { listerFiches } from './service.js';
import { exporterWaalaxy } from './waalaxy.js';

type Json = Record<string, unknown>;

describe('base vivante : listes, étiquettes et mandat assigné', () => {
  let t: TestApp;
  let base: Instance;
  let autre: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-lt', nom: 'Base', type: 'propre' });
    autre = await createInstance(t.owner.db, { slug: 'bv-lt-b', nom: 'Autre', type: 'propre' });
    await createInstance(t.owner.db, { slug: 'bv-lt-m', nom: 'Mandat Fictif', type: 'mandat' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    for (const table of ['base_liste_fiches', 'base_listes', 'base_vivante'])
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
    registerBaseVivanteRoutes(a, { db: t.app.db });
    return a;
  };
  const appel = async (
    a: ReturnType<typeof app>,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const r = await a.inject({ method, url: `/api/i/bv-lt/base${url}`, payload: payload as Json });
    return { status: r.statusCode, corps: r.json<Json>() };
  };
  const trois = () =>
    integrer(
      base,
      {
        entreprise: 'A Fictif',
        nom: 'Un',
        email: 'un@a.test',
        linkedin: 'https://linkedin.com/in/un',
      },
      { entreprise: 'B Fictif', nom: 'Deux', email: 'deux@b.test' },
      { entreprise: 'C Fictif', nom: 'Trois', email: 'trois@c.test' },
    );
  const noms = async (filtres = {}, instance = base) =>
    (await listerFiches(t.app.db, instance.id, filtres)).fiches.map((f) => f.nom).sort();

  it('crée, renomme et supprime une liste, avec un nom unique', async () => {
    const a = app();
    const cree = await appel(a, 'POST', '/listes', { nom: '  Industrie Ain ' });
    expect(cree.status).toBe(200);
    expect(cree.corps).toMatchObject({ nom: 'Industrie Ain', mandat: null });
    const id = cree.corps.id as string;
    expect((await appel(a, 'POST', '/listes', { nom: 'industrie ain' })).status).toBe(400);
    expect((await appel(a, 'POST', '/listes', { nom: '   ' })).status).toBe(400);
    expect((await appel(a, 'PATCH', `/listes/${id}`, { nom: 'Ain' })).status).toBe(200);
    const liste = await appel(a, 'GET', '');
    expect(liste.corps.listes).toEqual([{ id, nom: 'Ain', mandat: null, nombre: 0 }]);
    expect((await appel(a, 'DELETE', `/listes/${id}`)).status).toBe(200);
    expect((await appel(a, 'GET', '')).corps.listes).toEqual([]);
  });

  it('range des contacts dans une liste, sans doublon, et filtre sur elle', async () => {
    const [un, deux] = await trois();
    const a = app();
    const { corps } = await appel(a, 'POST', '/listes', { nom: 'À appeler' });
    const ids = [un, deux, un];
    const ajout = await appel(a, 'POST', `/listes/${corps.id as string}/fiches`, { ids });
    expect(ajout.corps).toEqual({ ajoutees: 2 });
    expect((await appel(a, 'POST', `/listes/${corps.id as string}/fiches`, { ids })).corps).toEqual(
      {
        ajoutees: 0,
      },
    );
    expect(await noms({ liste: corps.id as string })).toEqual(['DEUX', 'UN']);
    expect((await appel(a, 'GET', '')).corps.listes).toMatchObject([{ nombre: 2 }]);
    await appel(a, 'DELETE', `/listes/${corps.id as string}/fiches`, { ids: [un] });
    expect(await noms({ liste: corps.id as string })).toEqual(['DEUX']);
  });

  it('une fiche supprimée quitte ses listes, une liste supprimée laisse les fiches', async () => {
    const [un, deux] = await trois();
    const a = app();
    const { corps } = await appel(a, 'POST', '/listes', { nom: 'L' });
    await appel(a, 'POST', `/listes/${corps.id as string}/fiches`, { ids: [un, deux] });
    await appel(a, 'DELETE', '/fiches', { ids: [un] });
    expect((await appel(a, 'GET', '')).corps.listes).toMatchObject([{ nombre: 1 }]);
    await appel(a, 'DELETE', `/listes/${corps.id as string}`);
    expect(await noms()).toEqual(['DEUX', 'TROIS']);
  });

  it('n’accepte que des contacts de la même instance', async () => {
    const [un] = await trois();
    const [etranger] = await integrer(autre, {
      entreprise: 'Z Fictif',
      nom: 'Zed',
      email: 'z@z.test',
    });
    const a = app();
    const { corps } = await appel(a, 'POST', '/listes', { nom: 'L' });
    expect(
      (await appel(a, 'POST', `/listes/${corps.id as string}/fiches`, { ids: [un, etranger] }))
        .corps,
    ).toEqual({ ajoutees: 1 });
    const vue = await a.inject({ method: 'GET', url: '/api/i/bv-lt-b/base' });
    expect(vue.json<{ listes: unknown[] }>().listes).toEqual([]);
    const intrus = await a.inject({
      method: 'POST',
      url: `/api/i/bv-lt-b/base/listes/${corps.id as string}/fiches`,
      payload: { ids: [etranger] },
    });
    expect(intrus.statusCode).toBe(404);
  });

  it('assigne la liste à un mandat connu, et refuse un nom inconnu', async () => {
    const a = app();
    const { corps } = await appel(a, 'POST', '/listes', { nom: 'L', mandat: 'Mandat Fictif' });
    expect(corps.mandat).toBe('Mandat Fictif');
    expect(
      (await appel(a, 'PATCH', `/listes/${corps.id as string}`, { mandat: 'Inconnu' })).status,
    ).toBe(400);
    expect(
      (await appel(a, 'PATCH', `/listes/${corps.id as string}`, { mandat: null })).status,
    ).toBe(200);
    expect((await appel(a, 'GET', '')).corps.listes).toMatchObject([{ mandat: null }]);
  });

  it('étiquette des contacts, en minuscules et sans doublon, et filtre sur l’étiquette', async () => {
    const [un, deux] = await trois();
    const a = app();
    await appel(a, 'POST', '/tags', {
      ids: [un, deux],
      ajouter: [' Dirigeant ', 'dirigeant', 'Salon 2026'],
    });
    await appel(a, 'POST', '/tags', { ids: [deux], retirer: ['SALON 2026'] });
    const fiches = (await listerFiches(t.app.db, base.id)).fiches;
    expect(fiches.find((f) => f.nom === 'UN')?.tags).toEqual(['dirigeant', 'salon 2026']);
    expect(fiches.find((f) => f.nom === 'DEUX')?.tags).toEqual(['dirigeant']);
    expect(await noms({ tag: 'Salon 2026' })).toEqual(['UN']);
    expect((await appel(a, 'GET', '')).corps.tags).toEqual(['dirigeant', 'salon 2026']);
    expect((await appel(a, 'POST', '/tags', { ids: [un], ajouter: ['x'.repeat(41)] })).status).toBe(
      400,
    );
  });

  it('exporte vers Waalaxy la liste ou l’étiquette choisie', async () => {
    const [un, deux] = await integrer(
      base,
      { entreprise: 'A Fictif', nom: 'Un', linkedin: 'https://linkedin.com/in/un' },
      { entreprise: 'B Fictif', nom: 'Deux', linkedin: 'https://linkedin.com/in/deux' },
    );
    const a = app();
    const { corps } = await appel(a, 'POST', '/listes', { nom: 'L' });
    await appel(a, 'POST', `/listes/${corps.id as string}/fiches`, { ids: [un] });
    await appel(a, 'POST', '/tags', { ids: [deux], ajouter: ['salon'] });
    const parListe = await exporterWaalaxy(t.app.db, base.id, { liste: corps.id as string });
    expect(parListe.csv).toContain('/in/un');
    expect(parListe.csv).not.toContain('/in/deux');
    const parTag = await exporterWaalaxy(t.app.db, base.id, { tag: 'salon' });
    expect(parTag.csv).toContain('/in/deux');
    expect(parTag.csv).not.toContain('/in/un');
  });
});
