import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import {
  contactEchangesMail,
  contacts,
  opportunites,
  rdvContacts,
  rendezVous,
} from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { registerBaseVivanteRoutes } from './routes.js';

describe('GET /radar', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(async () => {
    await t.drop();
  });

  it('renvoie les quatre colonnes de la base et les prospects du CRM comme rendez-vous acceptés', async () => {
    const inst = await createInstance(t.owner.db, { slug: 'radar-r', nom: 'R', type: 'propre' });
    await withInstance(t.owner.db, inst.id, async (tx) => {
      const [alice, bruno] = await tx
        .insert(contacts)
        .values([
          { instanceId: inst.id, nom: 'Alice Fictive' },
          { instanceId: inst.id, nom: 'Bruno Fictif' },
        ])
        .returning();
      const [rdv] = await tx
        .insert(rendezVous)
        .values({ instanceId: inst.id, eventId: 'os:1', statut: 'rdv' })
        .returning();
      await tx
        .insert(rdvContacts)
        .values({ instanceId: inst.id, rendezVousId: rdv!.id, contactId: alice!.id });
      void bruno;
    });
    const app = Fastify();
    registerBaseVivanteRoutes(app, { db: t.app.db });
    const r = await app.inject({ method: 'GET', url: '/api/i/radar-r/radar' });
    expect(r.statusCode).toBe(200);
    const corps = r.json<{
      aEnrichir: { total: number };
      prets: { total: number };
      rdvAccepte: { total: number; fiches: { nom: string }[] };
    }>();
    expect(corps.aEnrichir.total).toBe(0);
    expect(corps.prets.total).toBe(0);
    expect(corps.rdvAccepte).toMatchObject({ total: 1, fiches: [{ nom: 'Alice Fictive' }] });
    expect((await app.inject({ method: 'GET', url: '/api/i/inconnue/radar' })).statusCode).toBe(
      404,
    );
  });

  it('reprend au Radar les affaires sans rendez-vous écrites sans réponse ou qui ont répondu, sans rien écrire', async () => {
    const inst = await createInstance(t.owner.db, { slug: 'radar-rep', nom: 'R', type: 'propre' });
    await withInstance(t.owner.db, inst.id, async (tx) => {
      const [muet, repond, jamais, avecRdv, close] = await tx
        .insert(contacts)
        .values(
          ['Muet Fictif', 'Repond Fictif', 'Jamais Ecrit', 'Avec Rdv', 'Affaire Close'].map(
            (nom) => ({ instanceId: inst.id, nom }),
          ),
        )
        .returning();
      await tx.insert(opportunites).values([
        { instanceId: inst.id, titre: 'Muette', etape: 'x', contactId: muet!.id },
        { instanceId: inst.id, titre: 'Répondue', etape: 'x', contactId: repond!.id },
        { instanceId: inst.id, titre: 'Jamais', etape: 'x', contactId: jamais!.id },
        { instanceId: inst.id, titre: 'AvecRdv', etape: 'x', contactId: avecRdv!.id },
        { instanceId: inst.id, titre: 'Close', etape: 'x', contactId: close!.id, clos: 'perdu' },
      ]);
      await tx.insert(contactEchangesMail).values([
        { instanceId: inst.id, contactId: muet!.id, envoyes: 2, recus: 0 },
        { instanceId: inst.id, contactId: repond!.id, envoyes: 1, recus: 1 },
        { instanceId: inst.id, contactId: avecRdv!.id, envoyes: 3, recus: 0 },
        { instanceId: inst.id, contactId: close!.id, envoyes: 3, recus: 0 },
      ]);
      const [rdv] = await tx
        .insert(rendezVous)
        .values({ instanceId: inst.id, eventId: 'os:rep', statut: 'rdv' })
        .returning();
      await tx
        .insert(rdvContacts)
        .values({ instanceId: inst.id, rendezVousId: rdv!.id, contactId: avecRdv!.id });
    });
    const avant = await t.owner.pool.query('select count(*)::int as n from opportunites');
    const app = Fastify();
    registerBaseVivanteRoutes(app, { db: t.app.db });
    const r = await app.inject({ method: 'GET', url: '/api/i/radar-rep/radar' });
    const corps = r.json<{
      reprise: Record<'contactes' | 'ontRepondu', { total: number; fiches: { titre: string }[] }>;
    }>();
    expect(corps.reprise.contactes).toMatchObject({ total: 1, fiches: [{ titre: 'Muette' }] });
    expect(corps.reprise.ontRepondu).toMatchObject({ total: 1, fiches: [{ titre: 'Répondue' }] });
    const apres = await t.owner.pool.query('select count(*)::int as n from opportunites');
    expect(apres.rows[0]).toEqual(avant.rows[0]);
  });
});
