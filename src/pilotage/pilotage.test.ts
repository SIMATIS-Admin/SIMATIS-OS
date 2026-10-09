import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { demoPortal, fakePortal } from '../../test/hubspot-portal.js';
import { buildApp } from '../app.js';
import { gmailConnector } from '../connecteurs/google/index.js';
import { hubspotConnector } from '../connecteurs/hubspot/index.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { taches } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { listInstances, setEcrituresReelles } from '../instances/service.js';

type Body = Record<string, unknown> & Record<string, unknown>[];

describe('Brief du jour and À valider', () => {
  let t: TestApp;
  let secretsDir: string;
  let app: ReturnType<typeof buildApp>;
  const gmailCalls: string[] = [];
  const portal = fakePortal(demoPortal());

  const req = async (method: 'GET' | 'POST', url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object });
    return { status: r.statusCode, body: r.json<Body>() };
  };
  const instance = async (slug: string) => {
    const i = (await listInstances(t.owner.db)).find((x) => x.slug === slug);
    if (!i) throw new Error(slug);
    return i;
  };

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-pilotage-'));
    await writeFile(
      path.join(secretsDir, 'simatis.env'),
      'GOOGLE_CLIENT_ID=c\nGOOGLE_CLIENT_SECRET=s\nHUBSPOT_TOKEN=pat-fictif\n',
    );
    await writeFile(
      path.join(secretsDir, 'simatis.google.json'),
      JSON.stringify({ refresh_token: 'rt' }),
    );
    registerConnector(
      gmailConnector({
        fetch: (url) => {
          gmailCalls.push(url);
          return Promise.resolve(
            new Response(
              JSON.stringify(url.includes('oauth2') ? { access_token: 'at' } : { id: 'draft-7' }),
            ),
          );
        },
      }),
    );
    registerConnector(hubspotConnector({ fetch: portal.fetch, sleep: () => Promise.resolve() }));
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir,
      realWrites: true,
    });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it('lists overdue and today tasks with their contact, and what was done', async () => {
    const { status, body } = await req('GET', '/api/i/simatis/brief');
    expect(status).toBe(200);
    expect(body).toMatchObject({ source: 'natif', rdvEtat: 'non_configure', rdv: [] });
    const list = body.taches as {
      titre: string;
      situation: string;
      entreprise: string | null;
    }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((x) => x.situation === 'retard' || x.situation === 'jour')).toBe(true);
    expect(list.find((x) => x.titre === 'Relancer Ateliers Morvan')).toMatchObject({
      situation: 'retard',
      entreprise: 'Ateliers Morvan',
    });
    expect(body.realisees).toHaveProperty('veille.jour');
  });

  it('marks a native task done: out of the day, counted today, journaled', async () => {
    const before = await req('GET', '/api/i/simatis/brief');
    const first = (before.body.taches as { id: string }[])[0];
    const done = await req('POST', `/api/i/simatis/taches/${first?.id}/fait`);
    expect(done.status).toBe(200);
    const after = await req('GET', '/api/i/simatis/brief');
    expect((after.body.taches as { id: string }[]).some((x) => x.id === first?.id)).toBe(false);
    expect((after.body.realisees as { aujourdhui: { total: number } }).aujourdhui.total).toBe(1);
  });

  it('shows the queue, filtered, with the contact of each draft', async () => {
    const all = await req('GET', '/api/i/simatis/propositions');
    expect(all.body).toHaveLength(6);
    const drafts = await req('GET', '/api/i/simatis/propositions?filtre=brouillon');
    expect(drafts.body).toHaveLength(2);
    expect(drafts.body[0]).toMatchObject({
      type: 'email.brouillon',
      statut: 'proposee',
      action: "Créer un brouillon d'email",
      contact: { entreprise: expect.any(String) as string },
    });
  });

  it('turns a validated email proposal into exactly one Gmail draft', async () => {
    const simatis = await instance('simatis');
    await withInstance(t.owner.db, simatis.id, (tx) =>
      configureConnexion(tx, { kind: 'messagerie', fournisseur: 'gmail', reglages: {} }),
    );
    await setEcrituresReelles(t.owner.db, 'simatis', true);
    const [draft] = (await req('GET', '/api/i/simatis/propositions?filtre=brouillon')).body;
    const result = await req('POST', `/api/i/simatis/propositions/${String(draft?.id)}/decision`, {
      decision: 'valider',
    });
    expect(result.body).toMatchObject({
      statut: 'appliquee',
      resultat: { simulation: false, id: 'draft-7' },
    });
    expect(gmailCalls.filter((u) => u.endsWith('/drafts'))).toHaveLength(1);

    const again = await req('POST', `/api/i/simatis/propositions/${String(draft?.id)}/decision`, {
      decision: 'valider',
    });
    expect(again.status).toBe(409);
  });

  it('calls nothing when the pilot discards a proposal', async () => {
    const before = gmailCalls.length;
    const [draft] = (await req('GET', '/api/i/simatis/propositions?filtre=brouillon')).body;
    const result = await req('POST', `/api/i/simatis/propositions/${String(draft?.id)}/decision`, {
      decision: 'ecarter',
    });
    expect(result.body).toMatchObject({ statut: 'ecartee' });
    expect(gmailCalls.length).toBe(before);
    expect((await req('GET', '/api/i/simatis/propositions?filtre=traites')).body).toHaveLength(2);
  });

  it('records a failure when the instance has no messaging connection', async () => {
    const [draft] = (await req('GET', '/api/i/demo/propositions?filtre=brouillon')).body;
    const result = await req('POST', `/api/i/demo/propositions/${String(draft?.id)}/decision`, {
      decision: 'valider',
    });
    expect(result.body).toMatchObject({ statut: 'echec' });
    expect(JSON.stringify(result.body.resultat)).toMatch(/messagerie/i);
  });

  it('creates the task in the OS when a CRM task proposal is validated without CRM', async () => {
    const aquaterra = await instance('simatis');
    const count = async () =>
      (
        await t.owner.pool.query<{ n: number }>(
          'select count(*)::int as n from taches where instance_id = $1',
          [aquaterra.id],
        )
      ).rows[0]?.n ?? 0;
    const before = await count();
    const [tache] = (await req('GET', '/api/i/simatis/propositions?filtre=tache')).body;
    const result = await req('POST', `/api/i/simatis/propositions/${String(tache?.id)}/decision`, {
      decision: 'valider',
    });
    expect(result.body).toMatchObject({ statut: 'appliquee' });
    expect(await count()).toBe(before + 1);
  });

  it('completes a HubSpot task in HubSpot, and refuses while the CRM is read-only', async () => {
    const simatis = await instance('simatis');
    const [tache] = await withInstance(t.owner.db, simatis.id, async (tx) => {
      await configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'deux_sens' },
      });
      return tx
        .insert(taches)
        .values({
          instanceId: simatis.id,
          source: 'hubspot',
          sourceId: '401',
          titre: 'Relance HubSpot',
          canal: 'email',
          echeance: new Date(),
        })
        .returning({ id: taches.id });
    });
    portal.calls.length = 0;
    const done = await req('POST', `/api/i/simatis/taches/${tache?.id}/fait`);
    expect(done.body).toMatchObject({ simulation: false });
    expect(portal.calls).toEqual([
      {
        method: 'PATCH',
        path: '/crm/v3/objects/tasks/401',
        body: { properties: { hs_task_status: 'COMPLETED' } },
      },
    ]);

    const [autre] = await withInstance(t.owner.db, simatis.id, async (tx) => {
      await configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'lecture' },
      });
      return tx
        .insert(taches)
        .values({
          instanceId: simatis.id,
          source: 'hubspot',
          sourceId: '402',
          titre: 'Autre',
          canal: 'appel',
          echeance: new Date(),
        })
        .returning({ id: taches.id });
    });
    expect((await req('POST', `/api/i/simatis/taches/${autre?.id}/fait`)).status).toBe(409);
  });
});
