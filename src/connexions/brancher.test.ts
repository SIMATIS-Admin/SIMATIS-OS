import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { demoPortal, fakePortal } from '../../test/hubspot-portal.js';
import { buildApp } from '../app.js';
import { hubspotConnector } from '../connecteurs/hubspot/index.js';
import { createInstance } from '../instances/service.js';
import { registerConnector } from './service.js';

const GOOD = 'pat-eu1-fictif-0000-1111-2222';
const CLIENT = { clientId: 'fictif-123.apps.example', clientSecret: 'secret-fictif' };

describe('connecting tools from Paramètres > Connexions', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let bare: FastifyInstance;
  let secretsDir: string;
  const tokenCalls: URLSearchParams[] = [];

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'mandat-a', nom: 'Mandat A', type: 'mandat' });
    await createInstance(t.owner.db, { slug: 'mandat-b', nom: 'Mandat B', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-brancher-'));
    const portal = fakePortal(demoPortal());
    registerConnector(
      hubspotConnector({
        sleep: () => Promise.resolve(),
        fetch: (url, init) =>
          (init.headers as Record<string, string>).authorization === `Bearer ${GOOD}`
            ? portal.fetch(url, init)
            : Promise.resolve(new Response('{"message":"Authentication failed"}', { status: 401 })),
      }),
    );
    const googleFetch = (_url: string, init: RequestInit) => {
      tokenCalls.push(new URLSearchParams(init.body as string));
      return Promise.resolve(
        new Response(JSON.stringify({ refresh_token: 'refresh-fictif', scope: 'gmail' })),
      );
    };
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir,
      googleClient: CLIENT,
      googleFetch,
    });
    bare = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });

  afterAll(async () => {
    await app.close();
    await bare.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  const connexionsOf = async (slug: string) => {
    const res = await app.inject({ method: 'GET', url: `/api/i/${slug}/connexions` });
    return { body: res.body, json: res.json<{ connexions: Record<string, unknown>[] }>() };
  };

  it('refuses a malformed or rejected HubSpot token without saving anything', async () => {
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/i/mandat-a/connexions/hubspot',
      payload: { token: 'pas un jeton' },
    });
    expect(malformed.statusCode).toBe(400);
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/i/mandat-a/connexions/hubspot',
      payload: { token: 'pat-eu1-faux-0000-0000-0000' },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json<{ error: string }>().error).toMatch(/refuse ce jeton/);
    await expect(stat(path.join(secretsDir, 'mandat-a.env'))).rejects.toThrow();
    expect((await connexionsOf('mandat-a')).json.connexions).toEqual([]);
  });

  it('checks a valid token, saves it 0600 for this instance only, and mirrors read-only', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/i/mandat-a/connexions/hubspot',
      payload: { token: `  ${GOOD}\n` },
    });
    expect(res.statusCode).toBe(200);
    const file = path.join(secretsDir, 'mandat-a.env');
    expect(await readFile(file, 'utf8')).toBe(`HUBSPOT_TOKEN=${GOOD}\n`);
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    const { body, json } = await connexionsOf('mandat-a');
    expect(body).not.toContain(GOOD);
    expect(json.connexions).toMatchObject([
      {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'lecture' },
        secret: { present: true },
      },
    ]);
    expect((await connexionsOf('mandat-b')).json.connexions).toEqual([]);
  });

  it('connects Google through the consent redirect, once per state', async () => {
    const start = await app.inject({
      method: 'POST',
      url: '/api/i/mandat-b/connexions/google/start',
      headers: { host: '127.0.0.1:4300' },
      payload: {},
    });
    expect(start.statusCode).toBe(200);
    const consent = new URL(start.json<{ url: string }>().url);
    expect(consent.searchParams.get('client_id')).toBe(CLIENT.clientId);
    expect(consent.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:4300/oauth/google/callback',
    );
    const state = consent.searchParams.get('state') ?? '';

    const forged = await app.inject({
      method: 'GET',
      url: '/oauth/google/callback?state=forged&code=x',
    });
    expect(forged.body).toMatch(/expirée/);

    const back = await app.inject({
      method: 'GET',
      url: `/oauth/google/callback?state=${state}&code=code-fictif`,
    });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe('/#/mandat-b/parametres?google=ok');
    expect(tokenCalls.at(-1)?.get('code_verifier')).toBeTruthy();
    expect(tokenCalls.at(-1)?.get('redirect_uri')).toBe(
      'http://127.0.0.1:4300/oauth/google/callback',
    );

    const env = await readFile(path.join(secretsDir, 'mandat-b.env'), 'utf8');
    expect(env).toContain(`GOOGLE_CLIENT_ID=${CLIENT.clientId}`);
    const google = JSON.parse(
      await readFile(path.join(secretsDir, 'mandat-b.google.json'), 'utf8'),
    ) as { refresh_token: string };
    expect(google.refresh_token).toBe('refresh-fictif');

    const { body, json } = await connexionsOf('mandat-b');
    expect(body).not.toContain('refresh-fictif');
    expect(body).not.toContain(CLIENT.clientSecret);
    expect(json.connexions.map((c) => [c.kind, c.fournisseur]).sort()).toEqual([
      ['agenda', 'google-agenda'],
      ['messagerie', 'gmail'],
    ]);

    const replay = await app.inject({
      method: 'GET',
      url: `/oauth/google/callback?state=${state}&code=code-fictif`,
    });
    expect(replay.body).toMatch(/expirée/);
  });

  it('refuses to start Google consent until the OS has a client', async () => {
    const before = await bare.inject({ method: 'GET', url: '/api/i/mandat-a/connexions' });
    expect(before.json()).toMatchObject({ googleClientDisponible: false });
    const res = await bare.inject({
      method: 'POST',
      url: '/api/i/mandat-a/connexions/google/start',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
