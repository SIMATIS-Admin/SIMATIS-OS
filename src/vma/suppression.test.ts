import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { creerInvitation } from './invitations.js';
import { registerVmaRoutes } from './routes.js';

const JETON = 'jeton-suppression-vma-'.padEnd(40, 'k');
const SITE = 'https://site.test';
const hex = () => randomBytes(16).toString('hex');

describe('suppression d’un test VMA', () => {
  let t: TestApp;
  let mandat: Instance;
  let autre: Instance;
  let appels: { methode: string; url: string }[];
  let siteRepond: number;

  const fetchSite = ((url: string | URL, init?: RequestInit) => {
    appels.push({ methode: init?.method ?? 'GET', url: String(url) });
    if (init?.method === 'DELETE')
      return Promise.resolve(new Response('{}', { status: siteRepond }));
    return Promise.resolve(
      Response.json(
        { id: hex(), expireLe: new Date(Date.now() + 86400000).toISOString() },
        { status: 201 },
      ),
    );
  }) as typeof globalThis.fetch;

  const route = (vma: { url: string; token: string } | null = { url: SITE, token: JETON }) => {
    const app = Fastify();
    registerVmaRoutes(app, {
      db: t.app.db,
      connexionDeps: { secretsDir: './secrets/inexistant', realWrites: false },
      vma,
      fetch: fetchSite,
    });
    return app;
  };

  const creer = (instance: Instance) =>
    creerInvitation(
      t.app.db,
      { url: SITE, token: JETON, fetch: fetchSite },
      { instanceId: instance.id, entrepriseNom: 'Atelier Fictif', type: 'essai' },
    );

  const compter = async () =>
    Number(
      (await t.owner.pool.query<{ count: string }>('select count(*) from vma_tests')).rows[0]!
        .count,
    );

  beforeAll(async () => {
    t = await setupTestApp();
    mandat = await createInstance(t.owner.db, {
      slug: 'suppr-mandat',
      nom: 'Mandat',
      type: 'mandat',
    });
    autre = await createInstance(t.owner.db, { slug: 'suppr-autre', nom: 'Autre', type: 'mandat' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await t.owner.pool.query('delete from vma_tests');
    appels = [];
    siteRepond = 200;
  });

  it('supprime un test déjà utilisé sans appeler le site', async () => {
    const test = await creer(mandat);
    await t.owner.pool.query("update vma_tests set statut = 'utilisee' where id = $1", [test.id]);
    appels = [];
    const res = await route().inject({
      method: 'DELETE',
      url: `/api/i/${mandat.slug}/vma/tests/${test.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(await compter()).toBe(0);
    expect(appels).toEqual([]);
  });

  it('révoque d’abord côté site une invitation encore ouverte', async () => {
    const test = await creer(mandat);
    appels = [];
    const res = await route().inject({
      method: 'DELETE',
      url: `/api/i/${mandat.slug}/vma/tests/${test.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(appels).toHaveLength(1);
    expect(appels[0]).toMatchObject({ methode: 'DELETE' });
    expect(await compter()).toBe(0);
  });

  it('garde le test si le site refuse la révocation', async () => {
    const test = await creer(mandat);
    siteRepond = 500;
    const res = await route().inject({
      method: 'DELETE',
      url: `/api/i/${mandat.slug}/vma/tests/${test.id}`,
    });
    expect(res.statusCode).toBe(400);
    expect(await compter()).toBe(1);
  });

  it('refuse un test d’une autre instance et un identifiant invalide', async () => {
    const test = await creer(autre);
    const res = await route().inject({
      method: 'DELETE',
      url: `/api/i/${mandat.slug}/vma/tests/${test.id}`,
    });
    expect(res.statusCode).toBe(404);
    expect(await compter()).toBe(1);
    const mauvais = await route().inject({
      method: 'DELETE',
      url: `/api/i/${mandat.slug}/vma/tests/pas-un-uuid`,
    });
    expect(mauvais.statusCode).toBe(400);
  });
});
