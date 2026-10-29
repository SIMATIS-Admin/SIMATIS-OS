import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance, setModule } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';
import { tourCerveau } from '../runner/runner.js';
import { viderFile, type Partage } from './file.js';
import { viderCarte } from './store.js';
import { registerCerveauRoutes } from './routes.js';

describe('Second cerveau : opérations (OS → runner → dossier)', () => {
  let t: TestApp;
  let runner: string;
  let dossier: string;
  // Faux espace partagé (réponses au format du serveur MCP « partage »).
  let kdrive: Map<string, string>;
  let partageFaux: Partage | null;
  const fauxPartage = (): Partage => ({
    auteur: 'marc',
    appeler: (outil, args) => {
      if (outil === 'lister_partage')
        return Promise.resolve(
          [...kdrive.keys()].map((p) => `- ${p} · 1 Ko · hier · Marc`).join('\n'),
        );
      if (outil === 'lire_partage') {
        const c = kdrive.get(String(args.chemin));
        return c === undefined
          ? Promise.reject(new Error('échec : introuvable'))
          : Promise.resolve(`[${String(args.chemin)} · modifié par Marc]\n\n${c}`);
      }
      if (outil === 'publier_document') {
        kdrive.set(String(args.chemin), String(args.contenu));
        return Promise.resolve('{"fait":true}');
      }
      return Promise.resolve('{"fait":true,"chemin":"echanges/2026-10-29-1300-marc-sujet.md"}');
    },
  });
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
      partage: () => Promise.resolve(partageFaux),
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
    await createInstance(t.owner.db, { slug: 'op-mandat', nom: 'M', type: 'mandat' });
    await setModule(t.owner.db, 'op-mandat', 'cerveau', true);
    await createInstance(t.owner.db, { slug: 'op-demo', nom: 'D', type: 'prospect' });
    await setModule(t.owner.db, 'op-demo', 'cerveau', true);
    runner = (await createToken(t.owner.db, { nom: 'runner', portee: 'runner' })).token;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    viderFile();
    viderCarte();
    kdrive = new Map([
      ['prospection/point.md', '# Point fictif\n'],
      ['reference/offre.md', '# Offre fictive\n'],
    ]);
    partageFaux = fauxPartage();
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

  it('ajoute une idée dans les idées en vrac', async () => {
    const res = await demander('op-ok', {
      type: 'ajouter',
      titre: 'Idée fictive',
      texte: 'Texte.',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ chemin: string }>().chemin).toMatch(
      /^brain\/idees-en-vrac\/.*idee-fictive\.md$/,
    );
  });

  it('n’accepte que concerne: os', async () => {
    const base = { type: 'ajouter', titre: 'x', texte: 'y' };
    expect((await demander('op-ok', { ...base, concerne: 'autre' })).statusCode).toBe(400);
    expect((await demander('op-ok', { ...base, concerne: 'os' })).statusCode).toBe(200);
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

  it('réserve les notes de la feuille de route à Mon activité', async () => {
    await mkdir(path.join(dossier, 'brain/outils'), { recursive: true });
    for (const nom of ['structure', 'feuille-de-route'])
      await writeFile(path.join(dossier, `brain/outils/simatis-os-${nom}.md`), `# ${nom} fictive`);
    for (const slug of ['op-mandat', 'op-demo'])
      for (const nom of ['structure', 'feuille-de-route']) {
        const chemin = `brain/outils/simatis-os-${nom}.md`;
        const corps = [
          { type: 'lire', chemin },
          { type: 'ecrire', chemin, contenu: 'x', empreinte: 'e' },
        ];
        for (const payload of corps)
          expect((await app.inject({ method: 'POST', url: url(slug), payload })).statusCode).toBe(
            403,
          );
      }
    const lue = await demander('op-ok', {
      type: 'lire',
      chemin: 'brain/outils/simatis-os-feuille-de-route.md',
    });
    expect(lue.statusCode).toBe(200);
  });

  describe('espace partagé', () => {
    it('lit une note du dossier de Christophe en lecture seule, et la sienne modifiable', async () => {
      const autre = await demander('op-ok', {
        espace: 'partage',
        type: 'lire',
        chemin: 'reference/offre.md',
      });
      expect(autre.json<{ lectureSeule: string }>().lectureSeule).toMatch(/Christophe/);
      const sienne = await demander('op-ok', {
        espace: 'partage',
        type: 'lire',
        chemin: 'prospection/point.md',
      });
      expect(sienne.json<{ lectureSeule: unknown }>().lectureSeule).toBeNull();
    });

    it('enregistre dans prospection/, refuse reference/ et un document modifié ailleurs', async () => {
      const lu = (
        await demander('op-ok', { espace: 'partage', type: 'lire', chemin: 'prospection/point.md' })
      ).json<{ empreinte: string }>();
      const ok = await demander('op-ok', {
        espace: 'partage',
        type: 'ecrire',
        chemin: 'prospection/point.md',
        contenu: '# Point fictif\n\nNouveau.',
        empreinte: lu.empreinte,
      });
      expect(ok.statusCode).toBe(200);
      expect(kdrive.get('prospection/point.md')).toContain('Nouveau.');

      const refus = await demander('op-ok', {
        espace: 'partage',
        type: 'ecrire',
        chemin: 'reference/offre.md',
        contenu: 'x',
        empreinte: 'e',
      });
      expect(refus.statusCode).toBe(400);
      expect(kdrive.get('reference/offre.md')).toBe('# Offre fictive\n');

      kdrive.set('prospection/point.md', 'changé par Christophe\n');
      const perime = await demander('op-ok', {
        espace: 'partage',
        type: 'ecrire',
        chemin: 'prospection/point.md',
        contenu: 'écrasement',
        empreinte: lu.empreinte,
      });
      expect(perime.statusCode).toBe(409);
    });

    it('dépose un message, puis la carte de l’espace partagé est lisible à part', async () => {
      const m = await demander('op-ok', {
        espace: 'partage',
        type: 'message',
        genre: 'question',
        sujet: 'Sujet',
        corps: 'Corps',
      });
      expect(m.statusCode).toBe(200);
      expect(m.json<{ chemin: string }>().chemin).toMatch(/^echanges\//);
      const carte = await app.inject({
        method: 'GET',
        url: '/api/i/op-ok/cerveau/carte?espace=partage',
      });
      expect(carte.json<{ noeuds: unknown[] }>().noeuds).toHaveLength(2);
      const simatis = await app.inject({ method: 'GET', url: '/api/i/op-ok/cerveau/carte' });
      expect(simatis.json()).toBeNull();
    });

    it('explique quand le serveur « partage » est absent du poste', async () => {
      partageFaux = null;
      const res = await demander('op-ok', { espace: 'partage', type: 'lire', chemin: 'index.md' });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toMatch(/pas connecté/);
    });

    it('refuse un message mal formé', async () => {
      const res = await app.inject({
        method: 'POST',
        url: url('op-ok'),
        payload: { espace: 'partage', type: 'message', genre: 'cri', sujet: 's', corps: 'c' },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
