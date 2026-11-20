import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance } from '../instances/service.js';
import { registerPassationRoutes } from './passation-routes.js';
import { createProjet } from './service.js';

const JETON = 'jeton-passation-'.padEnd(40, 'k');

describe('route « Lancer le diagnostic »', () => {
  let t: TestApp;
  let slug: string;
  let envoyes: { url: string; corps: Record<string, unknown> }[];
  let siteRepond: number;

  const fetchSite = ((url: string | URL, init?: RequestInit) => {
    envoyes.push({
      url: String(url),
      corps: JSON.parse(init?.body as string) as Record<string, unknown>,
    });
    return Promise.resolve(
      siteRepond === 201
        ? Response.json(
            {
              lien: 'https://site.test/diagnostic-endurance?t=abc&d=x',
              expireLe: '2026-11-21T00:00:00.000Z',
            },
            { status: 201 },
          )
        : new Response('{}', { status: siteRepond }),
    );
  }) as typeof globalThis.fetch;

  const route = (
    vma: { url: string; token: string } | null = { url: 'https://site.test', token: JETON },
  ) => {
    const app = Fastify();
    registerPassationRoutes(app, { db: t.app.db, vma, fetch: fetchSite });
    return app;
  };

  beforeAll(async () => {
    t = await setupTestApp();
    const inst = await createInstance(t.owner.db, {
      slug: 'simatis-lancer',
      nom: 'SIMATIS',
      type: 'propre',
    });
    slug = inst.slug;
    envoyes = [];
    siteRepond = 201;
  });
  afterAll(async () => {
    await t.drop();
  });

  it('prépare la fiche du projet sur le site et rend le lien', async () => {
    const projet = await createProjet(t.app.db, await instanceDe(), {
      nom: 'Entreprise Fictive',
      activite: 'services',
    });
    const r = await route().inject({
      method: 'POST',
      url: `/api/i/${slug}/diagnostic/projets/${projet.id}/passation`,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ lien: string }>().lien).toContain('/diagnostic-endurance?t=');
    expect(envoyes.at(-1)).toMatchObject({
      url: 'https://site.test/api/diagnostic/preparer',
      corps: { projetId: projet.id, entreprise: 'Entreprise Fictive', activite: 'services' },
    });
  });

  it('503 sans configuration du site, 404 pour un projet inconnu, 502 si le site refuse', async () => {
    const projet = await createProjet(t.app.db, await instanceDe(), {
      nom: 'Entreprise Fictive 2',
      activite: 'services',
    });
    const url = `/api/i/${slug}/diagnostic/projets/${projet.id}/passation`;
    expect((await route(null).inject({ method: 'POST', url })).statusCode).toBe(503);
    expect(
      (
        await route().inject({
          method: 'POST',
          url: `/api/i/${slug}/diagnostic/projets/99999999-2222-3333-4444-555555555555/passation`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await route().inject({
          method: 'POST',
          url: `/api/i/${slug}/diagnostic/projets/pas-un-uuid/passation`,
        })
      ).statusCode,
    ).toBe(400);
    siteRepond = 401;
    expect((await route().inject({ method: 'POST', url })).statusCode).toBe(502);
    siteRepond = 201;
  });

  it('ouvre la console sans projet : lien du site, 503 sans configuration, 502 si le site refuse', async () => {
    const url = `/api/i/${slug}/diagnostic/console`;
    const r = await route().inject({ method: 'POST', url });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ lien: string }>().lien).toContain('/diagnostic-endurance?t=');
    expect(envoyes.at(-1)?.corps).toEqual({});
    expect((await route(null).inject({ method: 'POST', url })).statusCode).toBe(503);
    expect(
      (await route().inject({ method: 'POST', url: '/api/i/inconnue/diagnostic/console' }))
        .statusCode,
    ).toBe(404);
    siteRepond = 401;
    expect((await route().inject({ method: 'POST', url })).statusCode).toBe(502);
    siteRepond = 201;
  });

  async function instanceDe() {
    const { getInstanceBySlug } = await import('../instances/service.js');
    return (await getInstanceBySlug(t.app.db, slug))!;
  }
});
