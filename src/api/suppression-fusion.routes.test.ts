import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';

describe('Routes de suppression et de fusion', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;
  const base = '/api/i/sup-routes';

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'sup-routes', nom: 'Routes', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-sup-routes-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  const contact = async (nom: string) => {
    const r = await app.inject({ method: 'POST', url: `${base}/contacts`, payload: { nom } });
    expect(r.statusCode, r.body).toBe(201);
    return r.json<{ id: string }>().id;
  };
  const statut = async (id: string) =>
    (await app.inject({ method: 'GET', url: `${base}/fiches/contact/${id}` })).statusCode;
  const UUID_INCONNU = '00000000-0000-4000-8000-000000000000';

  it('supprime une fiche puis la déclare introuvable', async () => {
    const id = await contact('Personne à supprimer');
    const r = await app.inject({ method: 'DELETE', url: `${base}/fiches/contact/${id}` });
    expect(r.json()).toEqual({ ok: true });
    expect(await statut(id)).toBe(404);
    const encore = await app.inject({ method: 'DELETE', url: `${base}/fiches/contact/${id}` });
    expect(encore.statusCode).toBe(404);
  });

  it('supprime en masse et rapporte chaque fiche', async () => {
    const a = await contact('Lot un');
    const b = await contact('Lot deux');
    const r = await app.inject({
      method: 'POST',
      url: `${base}/fiches/contact/supprimer`,
      payload: { ids: [a, UUID_INCONNU, b] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      resultats: [
        { id: a, ok: true },
        { id: UUID_INCONNU, ok: false, erreur: 'Fiche introuvable dans cette instance' },
        { id: b, ok: true },
      ],
    });
    expect(await statut(a)).toBe(404);
  });

  it('refuse une sélection vide, trop grande ou un type inconnu', async () => {
    const post = (kind: string, ids: unknown) =>
      app.inject({ method: 'POST', url: `${base}/fiches/${kind}/supprimer`, payload: { ids } });
    expect((await post('contact', [])).statusCode).toBe(400);
    expect((await post('contact', Array(201).fill(UUID_INCONNU))).statusCode).toBe(400);
    expect((await post('autre', [UUID_INCONNU])).statusCode).toBe(404);
  });

  it('fusionne deux fiches et refuse la fusion d’une fiche avec elle-même', async () => {
    const garde = await contact('Fiche gardée');
    const absorbe = await contact('Fiche absorbée');
    const url = `${base}/fiches/contact/${garde}/fusion`;
    const meme = await app.inject({ method: 'POST', url, payload: { absorbeId: garde } });
    expect(meme.statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url, payload: { absorbeId: absorbe } });
    expect(r.json()).toEqual({ ok: true });
    expect(await statut(absorbe)).toBe(404);
    expect(await statut(garde)).toBe(200);
    const mauvais = await app.inject({
      method: 'POST',
      url,
      payload: { absorbeId: 'pas-un-uuid' },
    });
    expect(mauvais.statusCode).toBe(400);
  });
});
