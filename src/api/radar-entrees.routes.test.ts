import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';

describe('POST /radar/entrees', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;
  const base = '/api/i/radar-route';
  const ajouter = (payload: unknown) =>
    app.inject({ method: 'POST', url: `${base}/radar/entrees`, payload: payload as object });

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'radar-route', nom: 'R', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-radar-route-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it("crée l'entrée et répond 201 avec l'id de l'affaire", async () => {
    const r = await ajouter({
      nom: 'Alice Fictive',
      email: 'alice@exemple.test',
      canal: 'LinkedIn',
      etape: 1,
      origine: 'Origine Test',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json<{ id: string; contactId: string }>()).toEqual({
      id: expect.any(String),
      contactId: expect.any(String),
    });
  });

  it('refuse un corps sans nom, une étape 4 et un canal inconnu (400)', async () => {
    expect((await ajouter({ canal: 'LinkedIn' })).statusCode).toBe(400);
    expect((await ajouter({ nom: 'X', canal: 'LinkedIn', etape: 4 })).statusCode).toBe(400);
    expect((await ajouter({ nom: 'X', canal: 'Pigeon' })).statusCode).toBe(400);
  });

  it('refuse un second ajout pour le même contact ouvert (400)', async () => {
    const corps = { nom: 'Bruno Fictif', email: 'bruno@exemple.test', canal: 'E-mail' };
    expect((await ajouter(corps)).statusCode).toBe(201);
    const deux = await ajouter(corps);
    expect(deux.statusCode).toBe(400);
    expect(deux.json<{ error: string }>().error).toContain('déjà une affaire ouverte');
  });

  it('instance inconnue : 404', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/i/inconnue/radar/entrees',
      payload: { nom: 'X', canal: 'LinkedIn' },
    });
    expect(r.statusCode).toBe(404);
  });

  it("l'affaire créée apparaît dans le Pipeline avec son canal et son origine", async () => {
    const r = await ajouter({
      nom: 'Chloé Fictive',
      entreprise: 'Société Pipeline',
      canal: 'Téléphone',
      origine: 'Origine Pipeline',
    });
    const { id } = r.json<{ id: string }>();
    const p = await app.inject({ method: 'GET', url: `${base}/pipeline` });
    const o = p
      .json<{ opportunites: { id: string; origineCommerciale: string; canalRadar: string }[] }>()
      .opportunites.find((x) => x.id === id);
    expect(o).toMatchObject({ origineCommerciale: 'Origine Pipeline', canalRadar: 'Téléphone' });
  });
});
