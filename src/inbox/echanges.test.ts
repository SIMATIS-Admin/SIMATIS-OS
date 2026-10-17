import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { withInstance } from '../db/context.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { getInstanceBySlug } from '../instances/service.js';
import { createToken, resolveToken } from '../mcp/tokens.js';
import { promptEchange, tourEchanges, type RunnerOptions } from '../runner/runner.js';
import { abandonnerEchanges, DELAI_REPONSE_MS, MOTIF_SANS_REPONSE } from './echanges.js';

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };
type Echange = {
  id: string;
  statut: string;
  messages: { de: string; texte: string }[];
  brouillon: { type: string; titre: string; resume: string | null; echeance: string | null };
  erreur: string | null;
};

describe('Inbox : ajout avec Claude', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let base: string;
  let runnerToken: string;
  const clients: Client[] = [];

  const api = async (method: 'GET' | 'POST', url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object });
    return { status: r.statusCode, body: r.json<Echange>() };
  };
  const repondre = async (token: string, args: Record<string, unknown>) => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', base), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    const r = (await client.callTool({ name: 'repondre_ajout', arguments: args })) as TextResult;
    return { isError: r.isError === true, text: r.content[0]?.text ?? '' };
  };
  const tokenDe = async (args: string[]) => {
    const config = JSON.parse(
      await readFile(args[args.indexOf('--mcp-config') + 1] ?? '', 'utf8'),
    ) as { mcpServers: { simatis: { headers: { Authorization: string } } } };
    return config.mcpServers.simatis.headers.Authorization.slice('Bearer '.length);
  };
  // Stands in for Claude: answers the conversation with what `reponse` returns.
  const runner = (
    reponse: (echangeId: string) => Record<string, unknown> | null,
    vus: { args: string[]; token: string }[] = [],
  ): RunnerOptions => ({
    base,
    token: runnerToken,
    claude: 'faux-claude',
    lancer: async (_commande, args) => {
      const token = await tokenDe(args);
      vus.push({ args, token });
      const id = /echangeId ([0-9a-f-]{36})/.exec(args[1] ?? '')?.[1] ?? '';
      const r = reponse(id);
      if (r) expect((await repondre(token, { echangeId: id, ...r })).isError).toBe(false);
      return 0;
    },
  });

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    runnerToken = (await createToken(t.owner.db, { nom: 'runner', portee: 'runner' })).token;
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', lectureRole: t.lectureRole });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
    await t.drop();
  });

  it('turns what the pilot says into an entry the pilot checks, then adds to the Inbox', async () => {
    const ouvert = await api('POST', '/api/i/helioval/echanges', {
      texte: 'Faire le devis pour Dupont avant jeudi',
    });
    expect(ouvert.status).toBe(201);
    expect(ouvert.body.statut).toBe('attente_claude');
    const id = ouvert.body.id;
    // Nothing prepared yet: nothing to add.
    expect((await api('POST', `/api/i/helioval/echanges/${id}/ajouter`)).status).toBe(409);

    const vus: { args: string[]; token: string }[] = [];
    const n = await tourEchanges(
      runner(
        () => ({
          message: 'Quel est le prénom de M. Dupont ?',
          brouillon: { type: 'devis', titre: 'Faire le devis Dupont', resume: null },
        }),
        vus,
      ),
    );
    expect(n).toBe(1);
    // Claude only gets the answer tool, with a token of this instance, revoked afterwards.
    expect(vus[0]?.args).toContain('mcp__simatis__repondre_ajout');
    expect(vus[0]?.args).not.toContain('mcp__simatis__*');
    expect(vus[0]?.args[1]).toContain('Faire le devis pour Dupont avant jeudi');
    expect(await resolveToken(t.app.db, vus[0]?.token ?? '')).toBeNull();

    let e = (await api('GET', `/api/i/helioval/echanges/${id}`)).body;
    expect(e.statut).toBe('attente_pilote');
    expect(e.messages.map((m) => m.de)).toEqual(['pilote', 'claude']);
    expect(e.brouillon.titre).toBe('Faire le devis Dupont');

    expect(
      (await api('POST', `/api/i/helioval/echanges/${id}/messages`, { texte: 'Jean, jeudi 22' }))
        .body.statut,
    ).toBe('attente_claude');
    // While Claude is expected, the pilot cannot add nor write again.
    expect((await api('POST', `/api/i/helioval/echanges/${id}/ajouter`)).status).toBe(409);
    expect(
      (await api('POST', `/api/i/helioval/echanges/${id}/messages`, { texte: 'x' })).status,
    ).toBe(409);
    await tourEchanges(
      runner(() => ({
        message: "C'est noté.",
        brouillon: {
          type: 'devis',
          titre: 'Faire le devis de Jean Dupont',
          resume: 'Devis à envoyer.',
          echeance: '2026-10-22T12:00:00+02:00',
        },
      })),
    );
    e = (await api('GET', `/api/i/helioval/echanges/${id}`)).body;
    expect(e.messages).toHaveLength(4);

    const ajout = await app.inject({
      method: 'POST',
      url: `/api/i/helioval/echanges/${id}/ajouter`,
    });
    expect(ajout.statusCode).toBe(200);
    const { sujet } = ajout.json<{ sujet: { id: string; type: string; echeance: string } }>();
    expect(sujet).toMatchObject({ type: 'devis', echeance: '2026-10-22T10:00:00.000Z' });
    const inbox = await app.inject({ method: 'GET', url: '/api/i/helioval/inbox' });
    expect(inbox.json<{ id: string }[]>().map((s) => s.id)).toContain(sujet.id);
    // Added once only.
    expect((await api('POST', `/api/i/helioval/echanges/${id}/ajouter`)).status).toBe(409);
  });

  it('keeps a conversation in its instance', async () => {
    const id = (await api('POST', '/api/i/helioval/echanges', { texte: 'Rappeler Paul' })).body.id;
    expect((await api('GET', `/api/i/simatis/echanges/${id}`)).status).toBe(404);
    expect((await api('POST', `/api/i/simatis/echanges/${id}/annuler`)).status).toBe(404);
    expect((await api('POST', '/api/i/helioval/echanges', { texte: '  ' })).status).toBe(400);
    // A cancelled conversation is not handed to the runner.
    expect((await api('POST', `/api/i/helioval/echanges/${id}/annuler`)).body.statut).toBe(
      'annule',
    );
    expect(await tourEchanges(runner(() => null))).toBe(0);
  });

  it('hands the conversation back to the pilot when Claude does not answer', async () => {
    const id = (await api('POST', '/api/i/helioval/echanges', { texte: 'Préparer le CR' })).body.id;
    await tourEchanges(runner(() => null));
    const e = (await api('GET', `/api/i/helioval/echanges/${id}`)).body;
    expect(e.statut).toBe('attente_pilote');
    expect(e.erreur).toMatch(/n'a pas répondu/);
    // Writing again asks Claude again, without the old error.
    const relance = await api('POST', `/api/i/helioval/echanges/${id}/messages`, {
      texte: 'Le CR du rendez-vous de mardi',
    });
    expect(relance.body).toMatchObject({ statut: 'attente_claude', erreur: null });
    await api('POST', `/api/i/helioval/echanges/${id}/annuler`);
  });

  it('refuses an « à valider » entry and an answer outside of a run', async () => {
    const id = (await api('POST', '/api/i/helioval/echanges', { texte: 'Valider le devis' })).body
      .id;
    await tourEchanges({
      ...runner(() => null),
      lancer: async (_c, args) => {
        const token = await tokenDe(args);
        const r = await repondre(token, {
          echangeId: id,
          message: 'ok',
          brouillon: { type: 'a_valider', titre: 'x' },
        });
        expect(r.isError).toBe(true);
        return 0;
      },
    });
    // Run over: the conversation waits for the pilot, Claude can no longer answer it.
    const helioval = await getInstanceBySlug(t.app.db, 'helioval');
    const token = (
      await createToken(t.owner.db, {
        nom: 'test',
        portee: 'instance',
        instanceId: helioval?.id ?? '',
      })
    ).token;
    expect((await repondre(token, { echangeId: id, message: 'encore' })).isError).toBe(true);
  });

  it('gives up a conversation nobody picked up after the delay', async () => {
    const id = (await api('POST', '/api/i/helioval/echanges', { texte: 'Relancer Marie' })).body.id;
    const helioval = await getInstanceBySlug(t.app.db, 'helioval');
    const plusTard = new Date(Date.now() + DELAI_REPONSE_MS + 1000);
    expect(
      await withInstance(t.app.db, helioval?.id ?? '', (tx) => abandonnerEchanges(tx, plusTard)),
    ).toBe(1);
    expect((await api('GET', `/api/i/helioval/echanges/${id}`)).body).toMatchObject({
      statut: 'attente_pilote',
      erreur: MOTIF_SANS_REPONSE,
    });
  });

  it("gives Claude today's date and the entry prepared so far", () => {
    const texte = promptEchange(
      {
        id: '00000000-0000-4000-8000-000000000000',
        instance: 'demo',
        nom: 'Démo',
        messages: [{ de: 'pilote', texte: 'Rappeler Paul demain', at: '' }],
        brouillon: { titre: 'Rappeler Paul' },
      },
      new Date('2026-10-16T10:00:00Z'),
    );
    expect(texte).toContain('vendredi 16 octobre 2026');
    expect(texte).toContain('Pilote : Rappeler Paul demain');
    expect(texte).toContain('"titre":"Rappeler Paul"');
  });
});
