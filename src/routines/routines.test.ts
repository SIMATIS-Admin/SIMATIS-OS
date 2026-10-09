import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { withInstance } from '../db/context.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { createInstance, getInstanceBySlug } from '../instances/service.js';
import { createToken, resolveToken } from '../mcp/tokens.js';
import { tour } from '../runner/runner.js';
import { heurePrevue, planifier } from './planification.js';
import { DejaEnCours, demanderExecution, getExecution, terminerExecution } from './service.js';

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };

describe('Routines Claude', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let base: string;
  let runnerToken: string;
  const clients: Client[] = [];

  const connect = async (token: string) => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', base), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    return client;
  };
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as TextResult;
    const text = result.content[0]?.text ?? '';
    return { isError: result.isError === true, text, json: <T>() => JSON.parse(text) as T };
  };
  const api = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as object });
  const instanceOf = async (slug: string) => {
    const i = await getInstanceBySlug(t.app.db, slug);
    if (!i) throw new Error(`no ${slug}`);
    return i;
  };

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    await createInstance(t.owner.db, { slug: 'sans-outils', nom: 'Sans outils', type: 'mandat' });
    runnerToken = (await createToken(t.owner.db, { nom: 'runner', portee: 'runner' })).token;
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', lectureRole: t.lectureRole });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
    await t.drop();
  });

  it('vigilance 5: refuses a second run while one is open, accepts a new one once it ended', async () => {
    const i = await instanceOf('helioval');
    await withInstance(t.app.db, i.id, async (tx) => {
      const first = await demanderExecution(tx, 'hebdo', 'pilote');
      await expect(demanderExecution(tx, 'hebdo', 'pilote')).rejects.toBeInstanceOf(DejaEnCours);
      await terminerExecution(tx, first.id, { fait: ['ok'], attente: [], echec: [] }, 'test');
      const second = await demanderExecution(tx, 'hebdo', 'pilote');
      expect(second.statut).toBe('demandee');
      return second;
    }).then(async (second) => {
      expect((await api('POST', '/api/i/helioval/routines/hebdo/executions')).statusCode).toBe(409);
      await withInstance(t.app.db, i.id, (tx) =>
        terminerExecution(tx, second.id, { fait: [], attente: [], echec: [] }, 'test'),
      );
    });
  });

  it('checks settings against their bounds and lets them drive taches_du_jour', async () => {
    expect(
      (await api('PATCH', '/api/i/simatis/routines/quotidienne', { params: { max: 99 } }))
        .statusCode,
    ).toBe(400);
    const ok = await api('PATCH', '/api/i/simatis/routines/quotidienne', {
      params: { canaux: ['email'], retard: 90 },
    });
    expect(ok.json()).toMatchObject({ params: { canaux: ['email'], max: 20 } });

    const { token } = await createToken(t.owner.db, {
      nom: 'test',
      portee: 'instance',
      instanceSlug: 'simatis',
    });
    const client = await connect(token);
    const taches = (await call(client, 'taches_du_jour')).json<{ canal: string }[]>();
    expect(taches.length).toBeGreaterThan(0);
    expect(taches.every((x) => x.canal === 'email')).toBe(true);
    const tout = (await call(client, 'taches_du_jour', { canaux: ['email', 'appel'] })).json<
      { canal: string }[]
    >();
    expect(tout.some((x) => x.canal === 'appel')).toBe(true);
  });

  it('stops a run when the instance has no messaging, with the reason in the report', async () => {
    const i = await instanceOf('sans-outils');
    const execution = await withInstance(t.app.db, i.id, (tx) =>
      demanderExecution(tx, 'quotidienne', 'pilote'),
    );
    const { token } = await createToken(t.owner.db, {
      nom: 'test',
      portee: 'instance',
      instanceSlug: 'sans-outils',
    });
    const client = await connect(token);
    const res = await call(client, 'proposer_brouillon', {
      contactId: crypto.randomUUID(),
      objet: 'Relance',
      corps: '<p>Bonjour</p>',
      executionId: execution.id,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toBe("Messagerie non configurée pour Sans outils : la routine s'arrête ici.");
    const after = await withInstance(t.app.db, i.id, (tx) => getExecution(tx, execution.id));
    expect(after.statut).toBe('echouee');
    expect(after.rapport?.echec).toEqual([res.text]);
  });

  it('runner: gives Claude a temporary token of the run’s instance only, then revokes it', async () => {
    const demo = await instanceOf('demo');
    // An email follow-up due yesterday, for a contact of the demo.
    await t.owner.pool.query(
      "insert into taches (instance_id, titre, canal, echeance, contact_id) select $1, 'Relancer', 'email', now() - interval '1 day', id from contacts where instance_id = $1 and email is not null limit 1",
      [demo.id],
    );
    const launched = await api('POST', '/api/i/demo/routines/quotidienne/executions');
    expect(launched.statusCode).toBe(200);
    const executionId = launched.json<{ id: string }>().id;
    const avant = await t.owner.pool.query<{ n: number }>(
      "select count(*)::int as n from propositions where instance_id = $1 and statut = 'proposee'",
      [demo.id],
    );

    let tokenVu = '';
    const n = await tour({
      base,
      token: runnerToken,
      claude: 'faux-claude',
      poste: () => Promise.resolve({ nom: 'poste-test', claude: '2.1 (Claude Code)', skills: [] }),
      // Stands in for Claude: reads the MCP config it was given and runs the routine with it.
      lancer: async (commande, args) => {
        expect(commande).toBe('faux-claude');
        expect(args).toContain('mcp__simatis__*');
        expect(args.join(' ')).toContain(executionId);
        const config = JSON.parse(
          await readFile(args[args.indexOf('--mcp-config') + 1] ?? '', 'utf8'),
        ) as {
          mcpServers: { simatis: { headers: { Authorization: string } } };
        };
        tokenVu = config.mcpServers.simatis.headers.Authorization.slice('Bearer '.length);
        const resolved = await resolveToken(t.app.db, tokenVu);
        expect(resolved?.instance?.slug).toBe('demo');

        const client = await connect(tokenVu);
        await call(client, 'etape_routine', {
          executionId,
          etape: 'Lire les tâches',
          statut: 'fait',
        });
        const taches = (
          await call(client, 'taches_du_jour', { canaux: ['email'], retardMaxJours: 90 })
        ).json<{ id: string; contactId: string | null }[]>();
        const avecContact = taches.filter((x) => x.contactId);
        expect(avecContact.length).toBeGreaterThan(0);
        for (const tache of avecContact) {
          const r = await call(client, 'proposer_brouillon', {
            tacheId: tache.id,
            objet: 'Relance',
            corps: '<p>Bonjour,</p>',
            executionId,
          });
          expect(r.isError).toBe(false);
        }
        const creneaux = (await call(client, 'creneaux_libres', { executionId })).json<unknown[]>();
        expect(creneaux).toHaveLength(3);
        await call(client, 'rapport_routine', {
          executionId,
          fait: [`${avecContact.length} brouillons proposés`],
          attente: [],
          echec: [],
        });
        return 0;
      },
    });
    expect(n).toBe(1);
    expect(await resolveToken(t.app.db, tokenVu)).toBeNull();
    const execution = await withInstance(t.app.db, demo.id, (tx) => getExecution(tx, executionId));
    expect(execution.statut).toBe('terminee');
    expect(execution.etapes.map((e) => e.etape)).toEqual(['Lire les tâches']);
    const apres = await t.owner.pool.query<{ n: number }>(
      "select count(*)::int as n from propositions where instance_id = $1 and statut = 'proposee'",
      [demo.id],
    );
    expect(apres.rows[0]?.n).toBeGreaterThan(avant.rows[0]?.n ?? 0);
  });

  it('runner: a run left without a report is marked failed', async () => {
    const launched = await api('POST', '/api/i/demo/routines/quotidienne/executions');
    const executionId = launched.json<{ id: string }>().id;
    await tour({
      base,
      token: runnerToken,
      claude: 'x',
      lancer: () => Promise.resolve(2),
      poste: () => Promise.resolve({ nom: 'poste-test', claude: null, skills: [] }),
    });
    const demo = await instanceOf('demo');
    const execution = await withInstance(t.app.db, demo.id, (tx) => getExecution(tx, executionId));
    expect(execution.statut).toBe('echouee');
    expect(execution.rapport?.echec[0]).toMatch(/code 2/);
    const refused = await fetch(`${base}/api/runner/demandes`, {
      headers: { authorization: 'Bearer faux' },
    });
    expect(refused.status).toBe(401);
  });

  it('plans the day’s runs at their time, catches up one missed run, never two', async () => {
    // Thursday 8 October 2026, 7:00 in Paris is 5:00 UTC.
    expect(heurePrevue('quotidienne', {}, '2026-10-08')?.toISOString()).toBe(
      '2026-10-08T05:00:00.000Z',
    );
    expect(heurePrevue('quotidienne', {}, '2026-10-10')).toBeNull();
    expect(heurePrevue('hebdo', {}, '2026-10-08')).toBeNull();
    expect(heurePrevue('hebdo', {}, '2026-10-12')?.toISOString()).toBe('2026-10-12T06:00:00.000Z');

    const avant = new Date('2026-10-08T04:30:00Z');
    expect(await planifier(t.app.db, avant)).toBe(0);
    const rattrapage = new Date('2026-10-08T09:00:00Z');
    const creees = await planifier(t.app.db, rattrapage);
    expect(creees).toBeGreaterThan(0);
    expect(await planifier(t.app.db, new Date('2026-10-08T10:00:00Z'))).toBe(0);
    const { rows } = await t.owner.pool.query<{ slug: string }>(
      "select i.slug from executions e join instances i on i.id = e.instance_id where e.demande_par = 'planification'",
    );
    expect(rows.map((r) => r.slug)).not.toContain('demo');
  });
});
