import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { withInstance } from '../db/context.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import type { Instance } from '../instances/schema.js';
import { createInstance, getInstanceBySlug } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';
import { demanderExecution, getExecution } from '../routines/service.js';
import { deposerSujet } from './depot.js';
import { attribuerReunion, deposerReunion } from './reunions.js';
import type { SujetTraite } from './report.js';
import { ajouterSujet, marquerTraite } from './service.js';
import type { SujetAjoute } from './report.js';

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };

describe('Inbox : outils MCP', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let client: Client;
  let helioval: Instance;
  let aquaterra: Instance;

  let base: string;
  const autres: Client[] = [];
  const clientDe = async (slug: string) => {
    const { token } = await createToken(t.owner.db, {
      nom: slug,
      portee: 'instance',
      instanceSlug: slug,
    });
    const c = new Client({ name: 'test', version: '0' });
    await c.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', base), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    autres.push(c);
    return c;
  };
  const call = async (name: string, args: Record<string, unknown> = {}, avec?: Client) => {
    const result = (await (avec ?? client).callTool({ name, arguments: args })) as TextResult;
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
    base = await app.listen({ host: '127.0.0.1', port: 0 });
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
    await Promise.all(autres.map((c) => c.close()));
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

  it("returns empty lists on a demo's fictive tools", async () => {
    const demo = await clientDe('demo');
    for (const outil of ['mails_sans_reponse', 'brouillons_en_attente', 'rendez_vous_passes']) {
      const r = await call(outil, {}, demo);
      expect(r.isError).toBe(false);
      expect(r.json()).toEqual([]);
    }
  });

  it('lists hand-added entries until the routine marks them noted in the second brain', async () => {
    const a = await ajouterSujet(t.app.db, helioval, {
      titre: 'Retour au client',
      resume: 'Supports',
      echeance: new Date('2026-10-23T10:00:00Z'),
    });
    // A routine subject is never listed as a hand-added entry.
    await withInstance(t.app.db, helioval.id, (tx) =>
      deposerSujet(tx, {
        type: 'autre',
        titre: 'Routine',
        origine: 'cerveau',
        source: 'routine',
        sourceId: 'r-1',
      }),
    );
    expect((await call('sujets_ajoutes', {}, await clientDe('aquaterra'))).json()).toEqual([]);
    const avant = (await call('sujets_ajoutes')).json<SujetAjoute[]>();
    expect(avant.map((x) => x.id)).toEqual([a.id]);
    expect(avant[0]).toMatchObject({ titre: 'Retour au client', resume: 'Supports' });
    expect((await call('marquer_note_cerveau', { ids: [a.id] })).json()).toEqual({ notes: 1 });
    expect((await call('marquer_note_cerveau', { ids: [a.id] })).json()).toEqual({ notes: 0 });
    expect((await call('sujets_ajoutes')).json<SujetAjoute[]>()).toEqual([]);
  });

  it('answers a readable error without stopping the run when messaging is missing', async () => {
    const i = await createInstance(t.owner.db, {
      slug: 'sans-messagerie',
      nom: 'Sans messagerie',
      type: 'mandat',
    });
    const execution = await withInstance(t.app.db, i.id, (tx) =>
      demanderExecution(tx, 'inbox', 'pilote'),
    );
    const c = await clientDe('sans-messagerie');
    const r = await call('mails_sans_reponse', {}, c);
    expect(r.isError).toBe(true);
    expect(r.text).toBe('Messagerie non configurée pour Sans messagerie.');
    const apres = await withInstance(t.app.db, i.id, (tx) => getExecution(tx, execution.id));
    expect(apres.statut).toBe('demandee');
  });
  describe('réunions Wispr Flow', () => {
    const reunion = (id: string, extra: Record<string, unknown> = {}) => ({
      wisprId: id,
      titre: 'Point fictif',
      debutAt: '2026-10-28T09:00:00+01:00',
      participants: ['dupont.fictif@exemple.fr'],
      resume: 'Résumé fictif',
      ...extra,
    });

    it('dépose une réunion, puis répond existant ; refuse une date sans fuseau', async () => {
      const premier = await call('deposer_reunion_wispr', reunion('mcp-w-1'));
      expect(premier.isError).toBe(false);
      const { statut, sujetId } = premier.json<{ statut: string; sujetId: string }>();
      expect(statut).toBe('cree');
      expect((await call('deposer_reunion_wispr', reunion('mcp-w-1'))).json()).toEqual({
        statut: 'existant',
        sujetId,
      });
      const sans = await call(
        'deposer_reunion_wispr',
        reunion('mcp-w-2', { debutAt: '2026-10-28T09:00:00' }),
      );
      expect(sans.isError).toBe(true);
    });

    it('liste les comptes rendus à faire, sans les traités ni ceux déjà reliés', async () => {
      const ouvert = await call(
        'deposer_sujet',
        sujet('cr-ouvert', { type: 'compte_rendu', origine: 'agenda' }),
      );
      const ferme = await call(
        'deposer_sujet',
        sujet('cr-ferme', { type: 'compte_rendu', origine: 'agenda' }),
      );
      const idFerme = ferme.json<{ id: string }>().id;
      await marquerTraite(t.app.db, helioval, idFerme);
      const idOuvert = ouvert.json<{ id: string }>().id;
      let liste = (await call('comptes_rendus_en_attente')).json<{ id: string }[]>();
      expect(liste.some((c) => c.id === idOuvert)).toBe(true);
      expect(liste.some((c) => c.id === idFerme)).toBe(false);
      await call('deposer_reunion_wispr', reunion('mcp-w-3', { sujetExistantId: idOuvert }));
      liste = (await call('comptes_rendus_en_attente')).json<{ id: string }[]>();
      expect(liste.some((c) => c.id === idOuvert)).toBe(false);
    });

    it('transcript : demandé pour une réunion critique seulement, puis enregistré', async () => {
      const { sujetId } = (await call('deposer_reunion_wispr', reunion('mcp-w-4'))).json<{
        sujetId: string;
      }>();
      expect(
        (await call('reunions_a_transcrire')).json<{ wisprId: string }[]>(),
      ).not.toContainEqual(expect.objectContaining({ wisprId: 'mcp-w-4' }));
      const refuse = await call('enregistrer_transcript', {
        wisprId: 'mcp-w-4',
        transcript: 'Texte fictif',
      });
      expect(refuse.isError).toBe(true);
      await withInstance(t.app.db, helioval.id, (tx) =>
        attribuerReunion(tx, sujetId, { contactId: null, entrepriseId: null, critique: true }),
      );
      expect((await call('reunions_a_transcrire')).json<{ wisprId: string }[]>()).toContainEqual({
        wisprId: 'mcp-w-4',
        sujetId,
      });
      const ok = await call('enregistrer_transcript', {
        wisprId: 'mcp-w-4',
        transcript: 'Texte fictif',
      });
      expect(ok.isError).toBe(false);
      expect(
        (await call('reunions_a_transcrire')).json<{ wisprId: string }[]>(),
      ).not.toContainEqual(expect.objectContaining({ wisprId: 'mcp-w-4' }));
    });

    it('ne voit que l’instance du jeton', async () => {
      await withInstance(t.app.db, aquaterra.id, (tx) =>
        deposerReunion(tx, {
          wisprId: 'mcp-w-ailleurs',
          titre: 'Ailleurs',
          debutAt: new Date(),
          participants: [],
          resume: null,
        }),
      );
      const r = await call('enregistrer_transcript', {
        wisprId: 'mcp-w-ailleurs',
        transcript: 'x',
      });
      expect(r.isError).toBe(true);
    });
  });
});
