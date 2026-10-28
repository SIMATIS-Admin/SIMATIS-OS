import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance } from '../instances/service.js';
import { registerVmaRoutes } from './routes.js';

const JETON = 'jeton-testeur-vma-'.padEnd(40, 'k');
const SITE = 'https://site.test';
const ID = 'a'.repeat(32);

describe('espace testeur du Test de VMA', () => {
  let t: TestApp;
  let slug: string;
  let appels: { url: string; auth: string | null; methode: string | undefined }[];
  let siteRepond: number;

  const fetchSite = ((url: string | URL, init?: RequestInit) => {
    appels.push({
      url: String(url),
      auth: new Headers(init?.headers).get('authorization'),
      methode: init?.method,
    });
    return Promise.resolve(
      siteRepond === 201
        ? Response.json({ id: ID, expireLe: '2026-11-01T00:00:00.000Z' }, { status: 201 })
        : new Response('{}', { status: siteRepond }),
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

  beforeAll(async () => {
    t = await setupTestApp();
    slug = (await createInstance(t.owner.db, { slug: 'testeur-vma', nom: 'M', type: 'mandat' }))
      .slug;
  });
  afterAll(async () => {
    await t.drop();
  });

  it("demande l'accès au site avec le jeton et rend le lien de l'espace testeur", async () => {
    appels = [];
    siteRepond = 201;
    const res = await route().inject({ method: 'POST', url: `/api/i/${slug}/vma/testeur` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      lien: `${SITE}/test-vma/testeur?t=${ID}`,
      expireLe: '2026-11-01T00:00:00.000Z',
    });
    expect(appels).toEqual([
      { url: `${SITE}/api/test-vma/testeur/acces`, auth: `Bearer ${JETON}`, methode: 'POST' },
    ]);
  });

  it("n'écrit rien dans l'OS : pas d'invitation, pas d'historique", async () => {
    siteRepond = 201;
    await route().inject({ method: 'POST', url: `/api/i/${slug}/vma/testeur` });
    const { rows } = await t.owner.pool.query<{ count: string }>('select count(*) from vma_tests');
    expect(rows[0]!.count).toBe('0');
  });

  it('refuse proprement quand le Test de VMA n’est pas configuré', async () => {
    const res = await route(null).inject({ method: 'POST', url: `/api/i/${slug}/vma/testeur` });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>().error).toMatch(/VMA_OS_TOKEN/);
  });

  it('signale un site qui refuse', async () => {
    siteRepond = 401;
    const res = await route().inject({ method: 'POST', url: `/api/i/${slug}/vma/testeur` });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/401/);
  });

  it('refuse une instance inconnue', async () => {
    const res = await route().inject({ method: 'POST', url: '/api/i/inconnue/vma/testeur' });
    expect(res.statusCode).toBe(404);
  });
});
