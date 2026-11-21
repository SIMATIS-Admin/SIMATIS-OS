import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';
import { actualiserLinkedin } from './linkedin.js';

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };

describe('LinkedIn : outils MCP de la routine', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let client: Client;
  let instanceId: string;

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as TextResult;
    const text = r.content[0]?.text ?? '';
    return { isError: r.isError === true, json: <T>() => JSON.parse(text) as T };
  };

  beforeAll(async () => {
    t = await setupTestApp();
    const i = await createInstance(t.owner.db, { slug: 'lko-simatis', nom: 'S', type: 'propre' });
    instanceId = i.id;
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', lectureRole: t.lectureRole });
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const { token } = await createToken(t.owner.db, {
      nom: 'lko',
      portee: 'instance',
      instanceSlug: 'lko-simatis',
    });
    client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', base), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
  });

  afterAll(async () => {
    await client.close();
    await app.close();
    await t.drop();
  });

  it('offers nothing to read, then the entry, then nothing once its text is stored', async () => {
    expect(
      (await call('messages_linkedin_a_lire')).json<{ messages: unknown[] }>().messages,
    ).toEqual([]);
    await withInstance(t.app.db, instanceId, (tx) =>
      actualiserLinkedin(tx, () =>
        Promise.resolve([
          {
            messageId: 'o1',
            threadId: 't-o1',
            de: 'LinkedIn <messages-noreply@linkedin.com>',
            objet: 'Votre résumé de la semaine',
            date: null,
            extrait: 'Aperçu du mail',
          },
        ]),
      ),
    );
    const { messages } = (await call('messages_linkedin_a_lire')).json<{
      messages: { id: string; apercu: string }[];
    }>();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.apercu).toBe('Aperçu du mail');
    const id = messages[0]?.id ?? '';

    const ok = await call('enregistrer_message_linkedin', {
      id,
      texte: 'Le message complet.',
      expediteur: 'Paul Fictif',
    });
    expect(ok.json()).toEqual({ statut: 'enregistre' });
    expect(
      (await call('messages_linkedin_a_lire')).json<{ messages: unknown[] }>().messages,
    ).toEqual([]);
    const { rows } = await t.owner.pool.query<{ titre: string; resume: string }>(
      'select titre, resume from sujets where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({
      titre: 'Message LinkedIn de Paul Fictif',
      resume: 'Le message complet.',
    });
  });

  it('answers « introuvable » for an unknown entry, without failing', async () => {
    const r = await call('enregistrer_message_linkedin', {
      id: '00000000-0000-4000-8000-000000000000',
      texte: 'x',
    });
    expect(r.isError).toBe(false);
    expect(r.json()).toEqual({ statut: 'introuvable' });
  });
});
