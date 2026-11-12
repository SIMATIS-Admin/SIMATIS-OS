import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';

describe('POST /contacts/:id/affaire', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;
  const base = '/api/i/aff-route';

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'aff-route', nom: 'R', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-aff-route-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it("crée l'affaire du contact, refuse une seconde affaire ouverte et les identifiants invalides", async () => {
    const contact = await app.inject({
      method: 'POST',
      url: `${base}/contacts`,
      payload: { nom: 'Alice Fictive' },
    });
    const { id } = contact.json<{ id: string }>();
    const ok = await app.inject({ method: 'POST', url: `${base}/contacts/${id}/affaire` });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json<{ titre: string }>().titre).toBe('Alice Fictive');
    const deux = await app.inject({ method: 'POST', url: `${base}/contacts/${id}/affaire` });
    expect(deux.statusCode).toBe(400);
    expect(deux.json<{ error: string }>().error).toContain('déjà une affaire ouverte');
    expect(
      (await app.inject({ method: 'POST', url: `${base}/contacts/pas-un-id/affaire` })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/api/i/inconnue/contacts/x/affaire' })).statusCode,
    ).toBe(404);
  });
});
