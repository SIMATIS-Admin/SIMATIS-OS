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
import { missions, partenaires } from './schema.js';

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };

// Fictitious partners only.
describe('Partenaires : outils MCP', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let url: URL;
  let token: string;
  let propre: Instance;
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
    propre = await createInstance(t.owner.db, {
      slug: 'mon-activite',
      nom: 'Mon activité',
      type: 'propre',
      config: { ecrituresReelles: true },
    });
    await t.owner.db.insert(partenaires).values([
      {
        instanceId: propre.id,
        connexionId: 'connexion-fictive-1',
        noeudId: 'noeud-fictif-1',
        nom: 'Alpes OS · Essai',
        partage: ['prospect'],
      },
      {
        instanceId: propre.id,
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
        instanceSlug: 'mon-activite',
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

  it('lists the connected partners with what they see', async () => {
    const r = (await call('missions_partenaires')).json<{
      partenaires: unknown[];
      missions: unknown[];
    }>();
    expect(r.partenaires).toEqual([
      expect.objectContaining({ nom: 'Alpes OS · Essai', statut: 'active', voit: ['prospect'] }),
      expect.objectContaining({ nom: 'Ancien OS · Essai', statut: 'coupee' }),
    ]);
    expect(r.missions).toEqual([]);
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
    const aValider = await withInstance(t.app.db, propre.id, (tx) =>
      tx.select().from(sujets).where(eq(sujets.type, 'a_valider')),
    );
    expect(aValider.map((s) => s.titre)).toEqual(['Un livre blanc sur un sujet fictif']);
  });

  it('names a fact waiting for validation by what it sends', async () => {
    await call('envoyer_donnee', {
      partenaire: 'Alpes OS',
      objet: 'prospect',
      evenement: 'modifie',
      ref: 'prospect-fictif-l2',
      champs: { entreprise: 'Entreprise fictive' },
    });
    const aValider = await withInstance(t.app.db, propre.id, (tx) =>
      tx.select().from(sujets).where(eq(sujets.type, 'a_valider')),
    );
    expect(aValider.map((s) => s.titre)).toContain('Envoyer à un partenaire : prospect modifie');
  });

  it('refuses an unknown or cut partner and lists the active ones', async () => {
    const inconnu = await call('confier_mission', { partenaire: 'Personne', consigne: 'x' });
    expect(inconnu.isError).toBe(true);
    expect(inconnu.text).toMatch(/Partenaires actifs : Alpes OS · Essai\./);
    const coupe = await call('confier_mission', { partenaire: 'Ancien', consigne: 'x' });
    expect(coupe.isError).toBe(true);
    expect(coupe.text).toMatch(/Connexion coupée/);
  });

  it('keeps the mission in simulation at L3 while real writes are closed', async () => {
    await withInstance(t.app.db, propre.id, (tx) => setNiveau(tx, 'partenaire', 'L3', 'pilote'));
    const r = (
      await call('confier_mission', {
        partenaire: 'Alpes OS',
        consigne: 'Une étude fictive',
        titre: 'Étude (essai)',
      })
    ).json<{ mission: string }>();
    expect(r).toMatchObject({ statut: 'appliquee', etat: 'simulation', titre: 'Étude (essai)' });
    const [m] = await withInstance(t.app.db, propre.id, (tx) =>
      tx.select().from(missions).where(eq(missions.id, r.mission)),
    );
    expect(m).toMatchObject({ etat: 'simulation', confieePar: 'agent:claude-marc' });
    const liste = (await call('missions_partenaires', { etat: 'simulation' })).json<{
      missions: unknown[];
    }>();
    expect(liste.missions).toEqual([
      expect.objectContaining({ titre: 'Étude (essai)', partenaire: 'Alpes OS · Essai' }),
    ]);
  });

  it('sends a fact only inside what the partner sees', async () => {
    const hors = await call('envoyer_donnee', {
      partenaire: 'Alpes OS',
      objet: 'affaire',
      evenement: 'gagne',
      ref: 'affaire-fictive',
      champs: { entreprise: 'Entreprise fictive' },
    });
    expect(hors.isError).toBe(true);
    expect(hors.text).toMatch(/ne voit pas les données « affaire »/);
    const dans = await call('envoyer_donnee', {
      partenaire: 'Alpes OS',
      objet: 'prospect',
      evenement: 'cree',
      ref: 'prospect-fictif',
      champs: { entreprise: 'Entreprise fictive', ville: 'Villefictive' },
    });
    expect(dans.json()).toMatchObject({ statut: 'appliquee', simulation: true });
  });
});
