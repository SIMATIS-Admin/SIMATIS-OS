import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';

describe('Route des mails d’une fiche', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;
  const base = '/api/i/mails-routes';

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'mails-routes', nom: 'Routes', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-mails-routes-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it('répond sans mail et avec la raison quand aucune messagerie n’est branchée', async () => {
    const { id } = (
      await app.inject({
        method: 'POST',
        url: `${base}/contacts`,
        payload: { nom: 'Contact de route', email: 'un@exemple.test' },
      })
    ).json<{ id: string }>();
    const r = await app.inject({ method: 'GET', url: `${base}/fiches/contact/${id}/mails` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ mails: [], adresses: 1 });
    expect(r.json<{ message: string }>().message).toMatch(/Aucune messagerie connectée/);
  });

  it('refuse une fiche inconnue ou un type invalide', async () => {
    const inconnu = '00000000-0000-4000-8000-000000000000';
    expect(
      (await app.inject({ method: 'GET', url: `${base}/fiches/contact/${inconnu}/mails` }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `${base}/fiches/autre/${inconnu}/mails` }))
        .statusCode,
    ).toBe(404);
  });
});
