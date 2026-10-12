import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { withInstance } from '../db/context.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import type { Instance } from '../instances/schema.js';
import { getInstanceBySlug } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';
import { deposerSujet } from './depot.js';
import type { SujetTraite } from './report.js';
import { marquerTraite } from './service.js';

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };

describe('Inbox : outils MCP', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let client: Client;
  let helioval: Instance;
  let aquaterra: Instance;

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as TextResult;
    const text = result.content[0]?.text ?? '';
    return { isError: result.isError === true, text, json: <T>() => JSON.parse(text) as T };
  };
  const sujet = (cle: string, extra: Record<string, unknown> = {}) => ({
    type: 'mail_a_repondre',
    titre: `Sujet ${cle}`,
    origine: 'messagerie',
    cle,
    ...extra,
  });

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', lectureRole: t.lectureRole });
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const { token } = await createToken(t.owner.db, {
      nom: 'inbox',
      portee: 'instance',
      instanceSlug: 'helioval',
    });
    client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', base), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const h = await getInstanceBySlug(t.app.db, 'helioval');
    const a = await getInstanceBySlug(t.app.db, 'aquaterra');
    if (!h || !a) throw new Error('instances de démo');
    helioval = h;
    aquaterra = a;
  });

  afterAll(async () => {
    await client.close();
    await app.close();
    await t.drop();
  });

  it('deposits a subject, then answers existant for the same key', async () => {
    const premier = await call(
      'deposer_sujet',
      sujet('fil-1', { lien: 'https://mail.exemple.fr/1' }),
    );
    expect(premier.isError).toBe(false);
    const { statut, id } = premier.json<{ statut: string; id: string }>();
    expect(statut).toBe('cree');
    expect((await call('deposer_sujet', sujet('fil-1'))).json()).toEqual({
      statut: 'existant',
      id,
    });
    const { rows } = await t.owner.pool.query<{ source: string; instance_id: string }>(
      'select source, instance_id from sujets where id = $1',
      [id],
    );
    expect(rows).toEqual([{ source: 'routine', instance_id: helioval.id }]);
  });

  it('refuses an a_valider subject or an os origin', async () => {
    expect((await call('deposer_sujet', sujet('faux-1', { type: 'a_valider' }))).isError).toBe(
      true,
    );
    expect((await call('deposer_sujet', sujet('faux-2', { origine: 'os' }))).isError).toBe(true);
  });

  it('returns a readable error for a link that is not a web address', async () => {
    const r = await call('deposer_sujet', sujet('fil-lien', { lien: 'javascript:alert(1)' }));
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Lien invalide');
  });

  it('lists treated subjects and marks them reported', async () => {
    const { id } = (await call('deposer_sujet', sujet('fil-traite'))).json<{ id: string }>();
    await marquerTraite(t.app.db, helioval, id);
    const traites = (await call('sujets_traites')).json<SujetTraite[]>();
    expect(traites.find((s) => s.id === id)).toMatchObject({
      statut: 'traite',
      sourceId: 'fil-traite',
    });
    expect((await call('marquer_reporte', { ids: [id] })).json()).toEqual({ reportes: 1 });
    const apres = (await call('sujets_traites')).json<SujetTraite[]>();
    expect(apres.some((s) => s.id === id)).toBe(false);
  });

  it('only sees the token instance', async () => {
    const { id } = await withInstance(t.app.db, aquaterra.id, (tx) =>
      deposerSujet(tx, {
        type: 'autre',
        titre: 'Sujet ailleurs',
        origine: 'cerveau',
        source: 'routine',
        sourceId: 'ailleurs',
      }),
    );
    await marquerTraite(t.app.db, aquaterra, id);
    const traites = (await call('sujets_traites')).json<SujetTraite[]>();
    expect(traites.some((s) => s.id === id)).toBe(false);
    expect((await call('marquer_reporte', { ids: [id] })).json()).toEqual({ reportes: 0 });
  });
});
