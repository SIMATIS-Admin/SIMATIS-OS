import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance, setModule } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';
import { registerCerveauRoutes } from './routes.js';

describe('Second cerveau : carte', () => {
  let t: TestApp;
  let runner: string;
  let instanceToken: string;
  const app = () => {
    const f = Fastify();
    registerCerveauRoutes(f, { db: t.app.db });
    return f;
  };
  const carte = {
    noeuds: [{ id: 'a.md', titre: 'A', categorie: 'racine', statut: null }],
    liens: [],
    autresFichiers: 2,
    tronquee: false,
  };
  const poster = (token: string, body: unknown = carte) =>
    app().inject({
      method: 'POST',
      url: '/api/runner/cerveau/carte',
      headers: { authorization: `Bearer ${token}` },
      payload: body as object,
    });

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'cv-ok', nom: 'A', type: 'propre' });
    await setModule(t.owner.db, 'cv-ok', 'cerveau', true);
    await createInstance(t.owner.db, { slug: 'cv-sans', nom: 'B', type: 'propre' });
    await createInstance(t.owner.db, { slug: 'cv-demo', nom: 'C', type: 'prospect' });
    await setModule(t.owner.db, 'cv-demo', 'cerveau', true);
    runner = (await createToken(t.owner.db, { nom: 'runner', portee: 'runner' })).token;
    instanceToken = (
      await createToken(t.owner.db, { nom: 'x', portee: 'instance', instanceSlug: 'cv-ok' })
    ).token;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    // Pas de carte tant que le runner n'en a pas envoyé : l'état de départ de chaque test.
    const { viderCarte } = await import('./store.js');
    viderCarte();
  });

  it('le runner dépose la carte, l’espace qui a le module la lit', async () => {
    expect((await poster(runner)).statusCode).toBe(200);
    const res = await app().inject({ method: 'GET', url: '/api/i/cv-ok/cerveau/carte' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ noeuds: [{ id: 'a.md' }], autresFichiers: 2 });
    expect(res.json<{ misAJour: string }>().misAJour).toEqual(expect.any(String));
  });

  it('sans carte déposée, la lecture répond null', async () => {
    const res = await app().inject({ method: 'GET', url: '/api/i/cv-ok/cerveau/carte' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('refuse sans le module, pour une démo, et pour une instance inconnue', async () => {
    expect(
      (await app().inject({ method: 'GET', url: '/api/i/cv-sans/cerveau/carte' })).statusCode,
    ).toBe(403);
    expect(
      (await app().inject({ method: 'GET', url: '/api/i/cv-demo/cerveau/carte' })).statusCode,
    ).toBe(403);
    expect(
      (await app().inject({ method: 'GET', url: '/api/i/nope/cerveau/carte' })).statusCode,
    ).toBe(404);
  });

  it('refuse le dépôt sans jeton runner et une carte invalide', async () => {
    expect((await poster(instanceToken)).statusCode).toBe(401);
    expect(
      (await app().inject({ method: 'POST', url: '/api/runner/cerveau/carte', payload: carte }))
        .statusCode,
    ).toBe(401);
    expect((await poster(runner, { noeuds: 'x' })).statusCode).toBe(400);
  });
});
