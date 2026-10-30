import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { withInstance } from '../db/context.js';
import { sujets } from '../inbox/schema.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';
import { setNiveau } from '../propositions/autonomie.js';
import { messagesPartenaires, missions, partenaires } from './schema.js';

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };

// Fictitious partners only.
describe('Partenaires : outils MCP', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let url: URL;
  let token: string;
  let client: Instance;
  const clients: Client[] = [];

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    const result = (await client.callTool({ name, arguments: args })) as TextResult;
    const text = result.content[0]?.text ?? '';
    return {
      isError: result.isError === true,
      text,
      json: <T = Record<string, unknown>>() => JSON.parse(text) as T,
    };
  };

  beforeAll(async () => {
    t = await setupTestApp();
    client = await createInstance(t.owner.db, {
      slug: 'client-fictif',
      nom: 'Client fictif',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    await t.owner.db.insert(partenaires).values([
      {
        instanceId: client.id,
        connexionId: 'connexion-fictive-1',
        noeudId: 'noeud-fictif-1',
        nom: 'Alpes OS · Essai',
      },
      {
        instanceId: client.id,
        connexionId: 'connexion-fictive-2',
        noeudId: 'noeud-fictif-2',
        nom: 'Ancien OS · Essai',
        statut: 'coupee',
      },
    ]);
    token = (
      await createToken(t.owner.db, {
        nom: 'claude-marc',
        portee: 'instance',
        instanceSlug: 'client-fictif',
      })
    ).token;
    // Real writes closed on the server: whatever the level, nothing leaves.
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', lectureRole: t.lectureRole });
    url = new URL('/mcp', await app.listen({ host: '127.0.0.1', port: 0 }));
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
    await t.drop();
  });

  const aValider = () =>
    withInstance(t.app.db, client.id, (tx) =>
      tx.select().from(sujets).where(eq(sujets.type, 'a_valider')),
    );
  const missionRecue = async (id: string, niveau: 'L2' | 'L3') => {
    const [p] = await t.owner.db
      .select()
      .from(partenaires)
      .where(eq(partenaires.connexionId, 'connexion-fictive-1'));
    await t.owner.db.insert(missions).values({
      id,
      instanceId: client.id,
      partenaireId: p?.id ?? '',
      sens: 'recue',
      titre: `Mission reçue (${niveau})`,
      consigne: 'Une consigne fictive',
      etat: 'working',
      niveau,
      contextId: `contexte-${id}`,
    });
  };

  it('lists the connected partners with what they see', async () => {
    const r = (await call('missions_partenaires')).json<{
      partenaires: unknown[];
      missions: unknown[];
      messages: unknown[];
    }>();
    expect(r.partenaires).toEqual([
      expect.objectContaining({
        nom: 'Alpes OS · Essai',
        statut: 'active',
        voit: {
          objets: ['entreprise', 'contact', 'affaire', 'tache', 'rendez_vous', 'activite'],
          champsExclus: [],
          qualification: false,
        },
        missionsRecues: 'L0',
      }),
      expect.objectContaining({ nom: 'Ancien OS · Essai', statut: 'coupee' }),
    ]);
    expect(r.missions).toEqual([]);
    expect(r.messages).toEqual([]);
  });

  it('leaves a mission waiting for Marc in the Inbox at the default level (L2)', async () => {
    const r = await call('confier_mission', {
      partenaire: 'alpes',
      consigne: 'Un livre blanc sur un sujet fictif',
    });
    expect(r.isError).toBe(false);
    expect(r.json()).toMatchObject({
      partenaire: 'Alpes OS · Essai',
      statut: 'en attente de validation dans l’Inbox',
    });
    expect((await aValider()).map((s) => s.titre)).toEqual(['Un livre blanc sur un sujet fictif']);
  });

  it('leaves a free message waiting for validation, named by its subject', async () => {
    const r = await call('envoyer_message', {
      partenaire: 'Alpes OS',
      type: 'question',
      sujet: 'Atelier fictif',
      texte: 'Voici le **compte rendu** : https://exemple.test/cr',
    });
    expect(r.json()).toMatchObject({ statut: 'en attente de validation dans l’Inbox' });
    expect((await aValider()).map((s) => s.titre)).toContain(
      'Message à Alpes OS · Essai : Atelier fictif',
    );
  });

  it('refuses an unknown or cut partner and lists the active ones', async () => {
    const inconnu = await call('confier_mission', { partenaire: 'Personne', consigne: 'x' });
    expect(inconnu.isError).toBe(true);
    expect(inconnu.text).toMatch(/Partenaires actifs : Alpes OS · Essai\./);
    const coupe = await call('envoyer_message', {
      partenaire: 'Ancien',
      type: 'info',
      sujet: 'x',
      texte: 'x',
    });
    expect(coupe.isError).toBe(true);
    expect(coupe.text).toMatch(/Connexion coupée/);
  });

  it('keeps the mission and the message in simulation at L3 while real writes are closed', async () => {
    await withInstance(t.app.db, client.id, (tx) => setNiveau(tx, 'partenaire', 'L3', 'pilote'));
    const r = (
      await call('confier_mission', {
        partenaire: 'Alpes OS',
        consigne: 'Une étude fictive',
        titre: 'Étude (essai)',
      })
    ).json<{ mission: string }>();
    expect(r).toMatchObject({ statut: 'appliquee', etat: 'simulation', titre: 'Étude (essai)' });
    const [m] = await withInstance(t.app.db, client.id, (tx) =>
      tx.select().from(missions).where(eq(missions.id, r.mission)),
    );
    expect(m).toMatchObject({ etat: 'simulation', confieePar: 'agent:claude-marc' });
    const liste = (await call('missions_partenaires', { etat: 'simulation' })).json<{
      missions: unknown[];
    }>();
    expect(liste.missions).toEqual([
      expect.objectContaining({ titre: 'Étude (essai)', partenaire: 'Alpes OS · Essai' }),
    ]);

    const msg = await call('envoyer_message', {
      partenaire: 'Alpes OS',
      type: 'info',
      sujet: 'Info fictive',
      texte: 'Rien de réel.',
    });
    expect(msg.json()).toMatchObject({ statut: 'appliquee', simulation: true });
    const envoyes = await withInstance(t.app.db, client.id, (tx) =>
      tx.select().from(messagesPartenaires),
    );
    expect(envoyes).toEqual([
      expect.objectContaining({ sens: 'envoye', sujet: 'Info fictive', simulation: true }),
    ]);
    const tous = (await call('missions_partenaires')).json<{ messages: unknown[] }>();
    expect(tous.messages).toEqual([
      expect.objectContaining({ sujet: 'Info fictive', sens: 'envoye', type: 'info' }),
    ]);
  });

  it('answers a received mission alone only when the partner is set to L3', async () => {
    await missionRecue('mission-recue-l2', 'L2');
    await missionRecue('mission-recue-l3', 'L3');
    const liste = (await call('missions_partenaires')).json<{
      missions: { id: string; sens: string; agentPeut?: string }[];
    }>();
    expect(liste.missions.find((m) => m.id === 'mission-recue-l2')).toMatchObject({
      sens: 'recue',
      agentPeut: expect.stringMatching(/validation de Marc/) as unknown,
    });

    // The autonomy of sends is L3 here: the partner's level still decides for an answer.
    const l2 = await call('repondre_mission', {
      mission: 'mission-recue-l2',
      etat: 'completed',
      message: 'Voici le document fictif.',
      resultat: { lien: 'https://exemple.test/doc' },
    });
    expect(l2.json()).toMatchObject({ statut: 'en attente de validation dans l’Inbox' });
    expect((await aValider()).map((s) => s.titre)).toContain(
      'Répondre à Alpes OS · Essai : « Mission reçue (L2) »',
    );

    const l3 = await call('repondre_mission', {
      mission: 'mission-recue-l3',
      etat: 'completed',
      message: 'Fait.',
    });
    expect(l3.json()).toMatchObject({ statut: 'appliquee', etat: 'completed', simulation: true });

    const inconnue = await call('repondre_mission', {
      mission: 'mission-absente',
      etat: 'completed',
      message: 'x',
    });
    expect(inconnue.isError).toBe(true);
  });
});
