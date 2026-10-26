import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { creerMonde, fabrique, type Monde } from '../../test/transfert.js';
import { buildApp } from '../app.js';

describe('Routes de transfert', () => {
  let t: TestApp;
  let m: Monde;
  let f: ReturnType<typeof fabrique>;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;

  beforeAll(async () => {
    t = await setupTestApp();
    m = await creerMonde(t);
    f = fabrique(t);
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-transfert-routes-'));
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      transfertDb: t.owner.db,
      version: 'test',
      secretsDir,
    });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  const corps = (id: string, extra: Record<string, unknown> = {}) => ({
    type: 'contact',
    id,
    instanceOrigine: 'siege',
    instanceCible: 'mandat-a',
    ...extra,
  });
  const post = (slug: string, url: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/i/${slug}/transfert${url}`,
      payload: payload as object,
    });

  it('donne le droit dans l’instance propre seulement', async () => {
    const siege = await app.inject({ method: 'GET', url: '/api/i/siege/transfert/droit' });
    const mandat = await app.inject({ method: 'GET', url: '/api/i/mandat-a/transfert/droit' });
    expect(siege.json()).toEqual({ autorise: true });
    expect(mandat.json()).toEqual({ autorise: false });
  });

  it('refuse (403) depuis un mandat', async () => {
    const id = await f.contact(m.siege, 'Refusé Fictif');
    expect((await post('mandat-a', '/apercu', corps(id))).statusCode).toBe(403);
    expect((await post('mandat-a', '', corps(id))).statusCode).toBe(403);
    expect(await f.instanceDe('contacts', id)).toBe(m.siege.id);
  });

  it('donne l’aperçu, puis déplace ; un second transfert ne trouve plus l’objet (404)', async () => {
    const id = await f.contact(m.siege, 'Déplacé Fictif');
    const apercu = await post('siege', '/apercu', corps(id));
    expect(apercu.statusCode).toBe(200);
    expect(apercu.json<{ racine: { mode: string } }>().racine.mode).toBe('deplace');
    const fait = await post('siege', '', corps(id));
    expect(fait.statusCode).toBe(200);
    expect(fait.json()).toMatchObject({ deplaces: 1, copies: 0 });
    expect(await f.instanceDe('contacts', id)).toBe(m.a.id);
    expect((await post('siege', '', corps(id))).statusCode).toBe(404);
  });

  it('404 pour un objet d’une autre instance que l’origine annoncée', async () => {
    const id = await f.contact(m.siege, 'Ailleurs Fictif');
    const r = await post('siege', '/apercu', corps(id, { instanceOrigine: 'mandat-b' }));
    expect(r.statusCode).toBe(404);
  });

  it('409 sur une copie déjà faite, puis 200 si le pilote insiste', async () => {
    const id = await f.contact(m.siege, 'Deux Fois', 'hubspot', 'r-1');
    expect((await post('siege', '', corps(id))).statusCode).toBe(200);
    const doublon = await post('siege', '', corps(id));
    expect(doublon.statusCode).toBe(409);
    expect(doublon.json<{ noeud: { type: string } }>().noeud.type).toBe('contact');
    expect((await post('siege', '', corps(id, { copierQuandMeme: true }))).statusCode).toBe(200);
  });

  it('400 pour un corps invalide ou une cible identique, 404 pour une instance inconnue', async () => {
    const id = await f.contact(m.siege, 'Corps Fictif');
    expect((await post('siege', '', { ...corps(id), type: 'bidon' })).statusCode).toBe(400);
    expect((await post('siege', '', corps('pas-un-uuid'))).statusCode).toBe(400);
    expect((await post('siege', '', corps(id, { instanceCible: 'siege' }))).statusCode).toBe(400);
    expect((await post('siege', '', corps(id, { instanceCible: 'nulle-part' }))).statusCode).toBe(
      404,
    );
  });
});
