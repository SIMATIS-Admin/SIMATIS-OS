import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance, setModule } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';
import { tourCerveau } from '../runner/runner.js';
import { viderFile } from './file.js';
import { registerCerveauRoutes } from './routes.js';

describe('Second cerveau : opérations (OS → runner → dossier)', () => {
  let t: TestApp;
  let runner: string;
  let dossier: string;
  const f = () => {
    const app = Fastify();
    registerCerveauRoutes(app, { db: t.app.db });
    return app;
  };
  let app: ReturnType<typeof f>;
  const url = (slug: string) => `/api/i/${slug}/cerveau/operations`;

  // Le runner du poste, branché sur l'app de test sans réseau.
  const passerRunner = () =>
    tourCerveau({
      base: 'http://os',
      token: runner,
      claude: 'faux',
      cerveau: dossier,
      fetch: (async (u: string, init?: { method?: string; body?: string }) => {
        const res = await app.inject({
          method: (init?.method ?? 'GET') as 'GET' | 'POST',
          url: new URL(u).pathname,
          headers: { authorization: `Bearer ${runner}`, 'content-type': 'application/json' },
          ...(init?.body ? { payload: init.body } : {}),
        });
        return new Response(res.body, { status: res.statusCode });
      }) as unknown as typeof fetch,
    });
  const demander = async (slug: string, corps: object) => {
    const attente = app.inject({ method: 'POST', url: url(slug), payload: corps });
    // La demande est en file avant le passage du runner.
    await new Promise((r) => setTimeout(r, 50));
    await passerRunner();
    return attente;
  };

  beforeAll(async () => {
    t = await setupTestApp();
    app = f();
    await createInstance(t.owner.db, { slug: 'op-ok', nom: 'A', type: 'propre' });
    await setModule(t.owner.db, 'op-ok', 'cerveau', true);
    await createInstance(t.owner.db, { slug: 'op-sans', nom: 'B', type: 'propre' });
    runner = (await createToken(t.owner.db, { nom: 'runner', portee: 'runner' })).token;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    viderFile();
    dossier = await mkdtemp(path.join(tmpdir(), 'cerveau-op-'));
    await mkdir(path.join(dossier, 'brain/inbox'), { recursive: true });
    await writeFile(path.join(dossier, 'log.md'), '# Journal des changements\n\n');
    await writeFile(path.join(dossier, 'brain/inbox/index.md'), '# Inbox\n');
    await writeFile(path.join(dossier, 'note.md'), '# Note fictive\n\nTexte.');
  });
  afterEach(() => rm(dossier, { recursive: true, force: true }));

  it('lit une note puis l’enregistre sur le dossier, et refuse un enregistrement périmé', async () => {
    const lu = await demander('op-ok', { type: 'lire', chemin: 'note.md' });
    expect(lu.statusCode).toBe(200);
    const { contenu, empreinte } = lu.json<{ contenu: string; empreinte: string }>();
    expect(contenu).toContain('Note fictive');

    const ecrit = await demander('op-ok', {
      type: 'ecrire',
      chemin: 'note.md',
      contenu: '# Note fictive\n\nChangée.',
      empreinte,
    });
    expect(ecrit.statusCode).toBe(200);
    expect(await readFile(path.join(dossier, 'note.md'), 'utf8')).toContain('Changée.');

    const perime = await demander('op-ok', {
      type: 'ecrire',
      chemin: 'note.md',
      contenu: 'écrasement',
      empreinte,
    });
    expect(perime.statusCode).toBe(409);
    expect(await readFile(path.join(dossier, 'note.md'), 'utf8')).toContain('Changée.');
  });

  it('ajoute une idée dans l’inbox', async () => {
    const res = await demander('op-ok', {
      type: 'ajouter',
      titre: 'Idée fictive',
      texte: 'Texte.',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ chemin: string }>().chemin).toMatch(/^brain\/inbox\/.*idee-fictive\.md$/);
  });

  it('refuse un chemin hors du dossier', async () => {
    const res = await demander('op-ok', { type: 'lire', chemin: '../secret.md' });
    expect(res.statusCode).toBe(400);
  });

  it('répond 504 quand le runner ne passe pas', async () => {
    const { demander: brut } = await import('./file.js');
    await expect(brut({ type: 'lire', chemin: 'note.md' }, 30)).rejects.toThrow();
  });

  it('refuse sans le module, une demande invalide et un jeton qui n’est pas celui du runner', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: url('op-sans'),
          payload: { type: 'lire', chemin: 'a.md' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: url('op-ok'), payload: { type: 'effacer' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/api/runner/cerveau/operations' })).statusCode,
    ).toBe(401);
  });
});
