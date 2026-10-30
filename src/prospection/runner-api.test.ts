import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { contacts, taches } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';
import { creerCampagneRelance, lireCampagne, reglageParDefaut } from './campagnes.js';

describe('API exécuteur : campagnes de prospection', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let instanceId: string;
  let auth: { authorization: string };

  beforeAll(async () => {
    t = await setupTestApp();
    instanceId = (
      await createInstance(t.owner.db, { slug: 'runner-camp', nom: 'Atelier', type: 'mandat' })
    ).id;
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    const { token } = await createToken(t.owner.db, { nom: 'runner', portee: 'runner' });
    auth = { authorization: `Bearer ${token}` };
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  async function nouvelle() {
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId, nom: 'Contact Fictif', email: 'contact@exemple.test' })
      .returning({ id: contacts.id });
    const [tc] = await t.owner.db
      .insert(taches)
      .values({ instanceId, titre: 'Relancer', canal: 'email', contactId: c!.id })
      .returning({ id: taches.id });
    return (
      await withInstance(t.app.db, instanceId, (tx) =>
        creerCampagneRelance(tx, { tacheIds: [tc!.id], reglage: reglageParDefaut() }),
      )
    ).campagneId;
  }
  const statut = async (id: string) =>
    (await withInstance(t.app.db, instanceId, (tx) => lireCampagne(tx, id))).statut;

  it('refuse un appel sans jeton d’exécuteur', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/runner/campagnes' })).statusCode).toBe(
      401,
    );
  });

  it('liste la campagne en attente, la prend une seule fois et rend un jeton d’instance', async () => {
    const id = await nouvelle();
    const liste = (
      await app.inject({ method: 'GET', url: '/api/runner/campagnes', headers: auth })
    ).json<{ id: string; instance: string; nbBrouillons: number }[]>();
    expect(liste.find((c) => c.id === id)).toMatchObject({
      instance: 'runner-camp',
      nbBrouillons: 1,
    });
    const prise = await app.inject({
      method: 'POST',
      url: `/api/runner/campagnes/${id}/demarrer`,
      headers: auth,
      payload: { instance: 'runner-camp' },
    });
    expect(prise.statusCode).toBe(200);
    expect(prise.json<{ token: string }>().token.length).toBeGreaterThan(20);
    const deux = await app.inject({
      method: 'POST',
      url: `/api/runner/campagnes/${id}/demarrer`,
      headers: auth,
      payload: { instance: 'runner-camp' },
    });
    expect(deux.statusCode).toBe(409);
    const apres = (
      await app.inject({ method: 'GET', url: '/api/runner/campagnes', headers: auth })
    ).json<{ id: string }[]>();
    expect(apres.some((c) => c.id === id)).toBe(false);
  });

  it('en fin avec erreur, la campagne passe en erreur', async () => {
    const id = await nouvelle();
    const { tokenId } = (
      await app.inject({
        method: 'POST',
        url: `/api/runner/campagnes/${id}/demarrer`,
        headers: auth,
        payload: { instance: 'runner-camp' },
      })
    ).json<{ tokenId: string }>();
    const fin = await app.inject({
      method: 'POST',
      url: `/api/runner/campagnes/${id}/fin`,
      headers: auth,
      payload: { instance: 'runner-camp', tokenId, erreur: 'Claude s’est arrêté' },
    });
    expect(fin.statusCode).toBe(200);
    expect(await statut(id)).toBe('erreur');
  });

  it('404 sur une instance inconnue', async () => {
    const id = await nouvelle();
    const r = await app.inject({
      method: 'POST',
      url: `/api/runner/campagnes/${id}/demarrer`,
      headers: auth,
      payload: { instance: 'inconnue' },
    });
    expect(r.statusCode).toBe(404);
  });
});
