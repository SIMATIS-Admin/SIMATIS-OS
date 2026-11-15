import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createToken } from '../../mcp/tokens.js';
import { setupTestApp, type TestApp } from '../../../test/database.js';
import { iaCumuls, iaJauges, iaSessions } from './schema.js';
import { declarerLancement, enregistrerReleve, type Releve } from './service.js';

const jetons = { entree: 100, sortie: 50, cacheEcriture: 0, cacheLecture: 1000 };

const releve = (over: Partial<Releve> = {}): Releve => ({
  passage: '2026-11-10T10:05:00.000Z',
  anomalies: 0,
  sessions: [
    {
      id: 'claude:session-fictive-1',
      fournisseur: 'claude',
      outil: 'code',
      sujet: 'PR #1',
      branche: 'feature/fictive',
      titre: 'Session fictive',
      cwd: '/tmp/projet-fictif',
      debut: '2026-11-10T09:10:00.000Z',
    },
  ],
  cumuls: [
    {
      sessionId: 'claude:session-fictive-1',
      heure: '2026-11-10T09:00:00.000Z',
      modele: 'claude-sonnet-5-5',
      ...jetons,
    },
  ],
  jauges: [],
  ...over,
});

describe('enregistrerReleve', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(async () => {
    await t.drop();
  });

  it('un relevé renvoyé deux fois remplace les cumuls', async () => {
    await enregistrerReleve(t.app.db, releve());
    await enregistrerReleve(t.app.db, releve());
    const lignes = await t.app.db.select().from(iaCumuls);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ entree: 100, sortie: 50, cacheLecture: 1000 });
    expect(lignes[0]?.cout).toBeGreaterThan(0);
    const [session] = await t.app.db.select().from(iaSessions);
    expect(session).toMatchObject({ origine: 'ext', sujet: 'PR #1' });
  });

  it('une session déclarée par l’exécuteur est IA-int avec son sujet', async () => {
    await declarerLancement(t.app.db, {
      moteur: 'claude',
      sessionId: 'session-fictive-2',
      debut: '2026-11-10T11:00:00.000Z',
      sujet: 'Routine fictive · Mandat A',
    });
    await enregistrerReleve(
      t.app.db,
      releve({
        sessions: [
          {
            id: 'claude:session-fictive-2',
            fournisseur: 'claude',
            outil: 'executeur',
            sujet: 'question',
            branche: null,
            titre: null,
            cwd: '/tmp/simatis-runner-x',
            debut: '2026-11-10T11:00:02.000Z',
          },
        ],
        cumuls: [],
      }),
    );
    const sessions = await t.app.db.select().from(iaSessions);
    expect(sessions.find((s) => s.id === 'claude:session-fictive-2')).toMatchObject({
      origine: 'int',
      sujet: 'Routine fictive · Mandat A',
    });
  });

  it('un lancement Codex est rattaché par cwd et heure', async () => {
    await declarerLancement(t.app.db, {
      moteur: 'codex',
      cwd: '/tmp/simatis-codex-fictif',
      debut: '2026-11-10T12:00:00.000Z',
      sujet: 'Recherche et enrichissement',
    });
    await enregistrerReleve(
      t.app.db,
      releve({
        sessions: [
          {
            id: 'chatgpt:fil-fictif',
            fournisseur: 'chatgpt',
            outil: 'executeur',
            sujet: 'question',
            branche: null,
            titre: null,
            cwd: '/tmp/simatis-codex-fictif',
            debut: '2026-11-10T12:00:30.000Z',
          },
        ],
        cumuls: [],
        jauges: [
          {
            fournisseur: 'chatgpt',
            at: '2026-11-10T12:01:00.000Z',
            utilise5h: 12,
            utiliseHebdo: 3,
            reset5h: '2026-11-10T16:00:00.000Z',
            resetHebdo: null,
          },
        ],
      }),
    );
    const sessions = await t.app.db.select().from(iaSessions);
    expect(sessions.find((s) => s.id === 'chatgpt:fil-fictif')).toMatchObject({
      origine: 'int',
      sujet: 'Recherche et enrichissement',
    });
    expect(await t.app.db.select().from(iaJauges)).toHaveLength(1);
  });

  it('une session exécuteur non déclarée est IA-int non identifiée', async () => {
    await enregistrerReleve(
      t.app.db,
      releve({
        sessions: [
          {
            id: 'claude:session-orpheline',
            fournisseur: 'claude',
            outil: 'executeur',
            sujet: 'question',
            branche: null,
            titre: null,
            cwd: '/tmp/ailleurs',
            debut: '2026-11-10T13:00:00.000Z',
          },
        ],
        cumuls: [],
      }),
    );
    const sessions = await t.app.db.select().from(iaSessions);
    expect(sessions.find((s) => s.id === 'claude:session-orpheline')).toMatchObject({
      origine: 'int',
      sujet: 'Lancement de l’OS non identifié',
    });
  });
});

describe('routes de l’exécuteur', () => {
  let t: TestApp;
  let app: FastifyInstance;
  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  it('la route refuse sans jeton runner', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/runner/conso-ia', payload: releve() });
    expect(r.statusCode).toBe(401);
  });

  it('la route enregistre le relevé et le lancement avec le jeton runner', async () => {
    const { token } = await createToken(t.owner.db, { nom: 'runner', portee: 'runner' });
    const headers = { authorization: `Bearer ${token}` };
    const l = await app.inject({
      method: 'POST',
      url: '/api/runner/lancements',
      headers,
      payload: { moteur: 'claude', sessionId: 'session-route', sujet: 'Routine fictive' },
    });
    expect(l.statusCode).toBe(200);
    const r = await app.inject({
      method: 'POST',
      url: '/api/runner/conso-ia',
      headers,
      payload: releve(),
    });
    expect(r.statusCode).toBe(200);
    expect(await t.app.db.select().from(iaCumuls)).toHaveLength(1);
  });
});
