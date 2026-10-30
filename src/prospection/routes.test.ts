import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';
import type { StatsProspection } from './stats.js';
import type { SignatureVue } from './signatures.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const image = { typeMime: 'image/png', imageBase64: png.toString('base64') };

describe('Routes de la prospection', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;
  const base = '/api/i/prosp-routes/prospection';
  const autre = '/api/i/prosp-autre/prospection';

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'prosp-routes', nom: 'Routes', type: 'mandat' });
    await createInstance(t.owner.db, { slug: 'prosp-autre', nom: 'Autre', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-prosp-routes-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  const vue = async (url = base) =>
    (await app.inject({ method: 'GET', url })).json<{
      stats: StatsProspection;
      signatures: SignatureVue[];
    }>();

  it("renvoie des zéros et l'objectif 30 pour une instance neuve", async () => {
    const v = await vue();
    expect(v.stats).toMatchObject({ jour: 0, semaine: 0, objectif: 30 });
    expect(v.signatures).toEqual([]);
  });

  it('404 sur une instance inconnue', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/i/inconnue/prospection' });
    expect(r.statusCode).toBe(404);
  });

  it("règle l'objectif puis le relit ; 400 au-delà de 500", async () => {
    const ok = await app.inject({
      method: 'PUT',
      url: `${base}/objectif`,
      payload: { objectif: 45 },
    });
    expect(ok.statusCode).toBe(200);
    expect((await vue()).stats.objectif).toBe(45);
    const trop = await app.inject({
      method: 'PUT',
      url: `${base}/objectif`,
      payload: { objectif: 501 },
    });
    expect(trop.statusCode).toBe(400);
    const texte = await app.inject({
      method: 'PUT',
      url: `${base}/objectif`,
      payload: { objectif: 'beaucoup' },
    });
    expect(texte.statusCode).toBe(400);
  });

  it("cycle complet d'une signature : création, défaut, image servie, renommage, suppression", async () => {
    const cree = await app.inject({
      method: 'POST',
      url: `${base}/signatures`,
      payload: { nom: 'Simatis', ...image },
    });
    expect(cree.statusCode).toBe(201);
    const { id } = cree.json<SignatureVue>();

    const defaut = await app.inject({
      method: 'PATCH',
      url: `${base}/signatures/${id}`,
      payload: { defaut: true },
    });
    expect(defaut.statusCode).toBe(200);
    expect((await vue()).signatures).toEqual([
      { id, nom: 'Simatis', defaut: true, typeMime: 'image/png' },
    ]);

    const img = await app.inject({ method: 'GET', url: `${base}/signatures/${id}/image` });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('private');
    expect(img.rawPayload.equals(png)).toBe(true);

    const renomme = await app.inject({
      method: 'PATCH',
      url: `${base}/signatures/${id}`,
      payload: { nom: 'Simatis et Kairos' },
    });
    expect(renomme.statusCode).toBe(200);
    const remplace = await app.inject({
      method: 'PUT',
      url: `${base}/signatures/${id}/image`,
      payload: image,
    });
    expect(remplace.statusCode).toBe(200);
    expect((await vue()).signatures[0]?.nom).toBe('Simatis et Kairos');

    const suppr = await app.inject({ method: 'DELETE', url: `${base}/signatures/${id}` });
    expect(suppr.statusCode).toBe(200);
    expect((await vue()).signatures).toEqual([]);
  });

  it('400 sur une image invalide, avec un message clair', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `${base}/signatures`,
      payload: {
        nom: 'Cassée',
        typeMime: 'image/png',
        imageBase64: Buffer.from('texte').toString('base64'),
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json<{ error: string }>().error).toContain('PNG');
  });

  it("404 sur une signature d'une autre instance", async () => {
    const cree = await app.inject({
      method: 'POST',
      url: `${autre}/signatures`,
      payload: { nom: 'Autre', ...image },
    });
    const { id } = cree.json<SignatureVue>();
    expect(
      (await app.inject({ method: 'GET', url: `${base}/signatures/${id}/image` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `${base}/signatures/${id}` })).statusCode,
    ).toBe(404);
    expect((await vue()).signatures).toEqual([]);
  });
});
