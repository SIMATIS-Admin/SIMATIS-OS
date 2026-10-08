import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { entreprises } from '../crm/schema.js';
import { createInstance } from '../instances/service.js';
import { createToken, revokeToken } from './tokens.js';

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };

describe('MCP server', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let url: URL;
  let tokenA: string;
  let tokenPortefeuille: string;
  let betaId: string;
  const clients: Client[] = [];

  const connect = async (token: string) => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    return client;
  };
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as TextResult;
    const text = result.content[0]?.text ?? '';
    return { isError: result.isError === true, text, json: () => JSON.parse(text) as unknown };
  };

  beforeAll(async () => {
    t = await setupTestApp();
    const a = await createInstance(t.owner.db, { slug: 'alpha', nom: 'Alpha', type: 'mandat' });
    const b = await createInstance(t.owner.db, { slug: 'beta', nom: 'Beta', type: 'mandat' });
    await t.owner.db.insert(entreprises).values({ instanceId: a.id, nom: 'Entreprise Alpha' });
    const [beta] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: b.id, nom: 'Entreprise Beta' })
      .returning({ id: entreprises.id });
    betaId = beta?.id ?? '';
    tokenA = (
      await createToken(t.owner.db, { nom: 'claude-a', portee: 'instance', instanceSlug: 'alpha' })
    ).token;
    tokenPortefeuille = (await createToken(t.owner.db, { nom: 'vue', portee: 'portefeuille' }))
      .token;

    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', lectureRole: t.lectureRole });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    url = new URL('/mcp', address);
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
    await t.drop();
  });

  it('answers with the instance of the token', async () => {
    const client = await connect(tokenA);
    expect((await call(client, 'instance_courante')).json()).toEqual({
      slug: 'alpha',
      nom: 'Alpha',
      type: 'mandat',
    });
  });

  it('never shows another instance in requete_lecture, even when asked for its row by id', async () => {
    const client = await connect(tokenA);
    expect(
      (await call(client, 'requete_lecture', { sql: 'select nom from v_entreprises' })).json(),
    ).toEqual([{ nom: 'Entreprise Alpha' }]);
    const byId = await call(client, 'requete_lecture', {
      sql: `select * from v_entreprises where id = '${betaId}'`,
    });
    expect(byId.json()).toEqual([]);
  });

  it('refuses tables outside the views, writes and chained statements', async () => {
    const client = await connect(tokenA);
    for (const sql of [
      'select * from entreprises',
      'select * from instances',
      'select * from jetons',
      "select 1) as x; update instances set nom = 'pirate' --",
      "insert into v_entreprises (nom) values ('x')",
    ]) {
      const result = await call(client, 'requete_lecture', { sql });
      expect(result.isError, sql).toBe(true);
    }
    const names = await t.owner.pool.query<{ nom: string }>(
      'select nom from instances order by nom',
    );
    expect(names.rows.map((r) => r.nom)).toEqual(['Alpha', 'Beta']);
  });

  it('journals each tool call with the agent as actor', async () => {
    const client = await connect(tokenA);
    await call(client, 'propositions_en_attente');
    const { rows } = await t.owner.pool.query<{ acteur: string }>(
      "select acteur from journal where action = 'Outil MCP : propositions_en_attente'",
    );
    expect(rows[0]?.acteur).toBe('agent:claude-a');
  });

  it('gives a portfolio token counters only, and no instance tool', async () => {
    const client = await connect(tokenPortefeuille);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['portefeuille']);
    const rows = (await call(client, 'portefeuille')).json() as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['aValider', 'entreprises', 'nom', 'slug', 'type']);
    }
  });

  it('rejects a missing, unknown or revoked token with 401', async () => {
    const post = (token?: string) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
    expect((await post()).status).toBe(401);
    expect((await post('smt_inconnu')).status).toBe(401);

    const { id, token } = await createToken(t.owner.db, {
      nom: 'jetable',
      portee: 'instance',
      instanceSlug: 'alpha',
    });
    expect(await revokeToken(t.owner.db, id)).toBe(true);
    expect((await post(token)).status).toBe(401);
  });
});
