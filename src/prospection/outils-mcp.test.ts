import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { contacts, taches } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { getInstanceBySlug } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';
import { creerCampagneRelance, lireCampagne, reglageParDefaut } from './campagnes.js';
import { demarrerCampagne } from './redaction.js';
import { CONSIGNES_REDACTION } from './outils-mcp.js';

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };

describe('Outils MCP de rédaction de campagne', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let client: Client;
  let instanceId: string;

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as TextResult;
    const text = r.content[0]?.text ?? '';
    return { isError: r.isError === true, text, json: <T>() => JSON.parse(text) as T };
  };

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', lectureRole: t.lectureRole });
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    // « demo » est un mandat prospect : ses connexions fictives sont acceptées.
    const instance = await getInstanceBySlug(t.app.db, 'demo');
    if (!instance) throw new Error('instance de démonstration');
    instanceId = instance.id;
    const { token } = await createToken(t.owner.db, {
      nom: 'campagne',
      portee: 'instance',
      instanceSlug: 'demo',
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

  async function campagneDe(noms: string[], reglage = reglageParDefaut()) {
    const ids: string[] = [];
    for (const nom of noms) {
      const [c] = await t.owner.db
        .insert(contacts)
        .values({
          instanceId,
          nom,
          fonction: 'Directeur',
          email: `${nom.toLowerCase()}@exemple.test`,
        })
        .returning({ id: contacts.id });
      const [tc] = await t.owner.db
        .insert(taches)
        .values({
          instanceId,
          titre: `Relancer ${nom}`,
          canal: 'email',
          contactId: c!.id,
          notes: 'Recommandé par un partenaire',
        })
        .returning({ id: taches.id });
      ids.push(tc!.id);
    }
    const r = await withInstance(t.app.db, instanceId, async (tx) => {
      const created = await creerCampagneRelance(tx, { tacheIds: ids, reglage });
      await demarrerCampagne(tx, created.campagneId);
      return created;
    });
    return r.campagneId;
  }
  const lire = (id: string) => withInstance(t.app.db, instanceId, (tx) => lireCampagne(tx, id));

  it('expose campagne_contexte et campagne_deposer', async () => {
    const noms = (await client.listTools()).tools.map((x) => x.name);
    expect(noms).toContain('campagne_contexte');
    expect(noms).toContain('campagne_deposer');
  });

  it('campagne_contexte renvoie contact, tâche, consignes et 3 créneaux par brouillon', async () => {
    const id = await campagneDe(['Alice', 'Bruno']);
    const r = await call('campagne_contexte', { campagneId: id });
    expect(r.isError).toBe(false);
    const c = r.json<{
      consignes: string;
      creneauxDemandes: boolean;
      brouillons: {
        id: string;
        contact: { nom: string; fonction: string };
        tache: { notes: string };
        touche: number;
        creneaux: string[];
      }[];
    }>();
    expect(c.consignes).toBe(CONSIGNES_REDACTION);
    expect(c.creneauxDemandes).toBe(true);
    expect(c.brouillons.map((b) => b.contact.nom).sort()).toEqual(['Alice', 'Bruno']);
    expect(c.brouillons[0]).toMatchObject({
      touche: 2,
      contact: { fonction: 'Directeur' },
      tache: { notes: 'Recommandé par un partenaire' },
    });
    for (const b of c.brouillons) expect(b.creneaux).toHaveLength(3);
    expect(new Set(c.brouillons.flatMap((b) => b.creneaux)).size).toBe(6);
  });

  it('sans créneaux demandés, aucun créneau n’est donné', async () => {
    const id = await campagneDe(['Carole'], { ...reglageParDefaut(), creneaux: false });
    const c = (await call('campagne_contexte', { campagneId: id })).json<{
      brouillons: { creneaux: string[] }[];
    }>();
    expect(c.brouillons[0]?.creneaux).toEqual([]);
  });

  it('campagne_deposer enregistre les brouillons nettoyés et passe en relecture', async () => {
    const id = await campagneDe(['Denis']);
    const [b] = (await lire(id)).brouillons;
    const r = await call('campagne_deposer', {
      campagneId: id,
      brouillons: [
        {
          id: b!.id,
          objet: 'Re: Échange',
          corps: '<p>Bonjour Denis,</p><script>x()</script><p>Bien à vous,</p>',
        },
      ],
    });
    expect(r.isError).toBe(false);
    const apres = await lire(id);
    expect(apres.statut).toBe('relecture');
    expect(apres.brouillons[0]?.corps).not.toContain('script');
  });

  it('campagne_deposer refuse un brouillon inconnu', async () => {
    const id = await campagneDe(['Emma']);
    const r = await call('campagne_deposer', {
      campagneId: id,
      brouillons: [{ id: '00000000-0000-4000-8000-000000000009', objet: 'x', corps: '<p>x</p>' }],
    });
    expect(r.isError).toBe(true);
    expect((await lire(id)).statut).toBe('redaction');
  });

  it('campagne_contexte refuse une campagne qui n’attend plus de brouillons', async () => {
    const id = await campagneDe(['Farid']);
    const [b] = (await lire(id)).brouillons;
    await call('campagne_deposer', {
      campagneId: id,
      brouillons: [{ id: b!.id, objet: 'x', corps: '<p>x</p>' }],
    });
    expect((await call('campagne_contexte', { campagneId: id })).isError).toBe(true);
  });
});
