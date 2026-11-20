import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';

describe("Routes de l'aide à la relance", () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;
  const url = '/api/i/aide-relance/aide-relance/masquees';

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'aide-relance', nom: 'Aide', type: 'mandat' });
    await createInstance(t.owner.db, { slug: 'aide-autre', nom: 'Autre', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-aide-relance-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it('retient un report puis le relit, par espace, et refuse un corps invalide', async () => {
    const jusqua = Date.now() + 3 * 86_400_000;
    const put = await app.inject({ method: 'PUT', url, payload: { id: 'ent:exemple', jusqua } });
    expect(put.statusCode).toBe(200);
    const lu = await app.inject({ method: 'GET', url });
    expect(lu.json()).toEqual({ 'ent:exemple': jusqua });
    const autre = await app.inject({
      method: 'GET',
      url: '/api/i/aide-autre/aide-relance/masquees',
    });
    expect(autre.json()).toEqual({});
    const mauvais = await app.inject({ method: 'PUT', url, payload: { id: '', jusqua } });
    expect(mauvais.statusCode).toBe(400);
    const inconnu = await app.inject({
      method: 'GET',
      url: '/api/i/inconnue/aide-relance/masquees',
    });
    expect(inconnu.statusCode).toBe(404);
  });

  it('masque un lot, relu ensuite, et refuse un lot invalide', async () => {
    const jusqua = Date.now() + 86_400_000;
    const put = await app.inject({
      method: 'PUT',
      url: `${url}/lot`,
      payload: { ids: ['ent:a', 'ent:b'], jusqua },
    });
    expect(put.statusCode).toBe(200);
    const lu = (await app.inject({ method: 'GET', url })).json<Record<string, number>>();
    expect(lu['ent:a']).toBe(jusqua);
    expect(lu['ent:b']).toBe(jusqua);
    const mauvais = await app.inject({
      method: 'PUT',
      url: `${url}/lot`,
      payload: { ids: [], jusqua },
    });
    expect(mauvais.statusCode).toBe(400);
  });
});
