import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { demoPortal, fakePortal } from '../../test/hubspot-portal.js';
import { buildApp } from '../app.js';
import { hubspotConnector } from '../connecteurs/hubspot/index.js';
import { configureConnexion, registerConnector, syncConnexion } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { CrmIndisponible } from './service.js';
import { createTache, listTaches, updateTache, type TacheVue } from './taches.js';

const TOKEN = 'pat-eu1-fictif-0000';

describe('Tâches', () => {
  let t: TestApp;
  let a: Instance;
  let armed: Instance;
  let sansCrm: Instance;
  let secretsDir: string;
  const portal = fakePortal(demoPortal());

  const off = () => ({ secretsDir, realWrites: false });
  const on = () => ({ secretsDir, realWrites: true });
  const row = async (id: string) =>
    (
      await t.owner.pool.query<{ titre: string; canal: string; fait_at: Date | null }>(
        'select titre, canal, fait_at from taches where id = $1',
        [id],
      )
    ).rows[0];
  const hubspotTache = async (sourceId: string) =>
    (
      await t.owner.pool.query<{ id: string }>(
        "select id from taches where instance_id = $1 and source = 'hubspot' and source_id = $2",
        [a.id, sourceId],
      )
    ).rows[0]?.id ?? '';
  const sens = (s: 'lecture' | 'deux_sens') =>
    withInstance(t.app.db, a.id, (tx) =>
      configureConnexion(tx, { kind: 'crm', fournisseur: 'hubspot', reglages: { sens: s } }),
    );

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'mandat-taches', nom: 'Mandat', type: 'mandat' });
    armed = { ...a, config: { ecrituresReelles: true } };
    sansCrm = await createInstance(t.owner.db, {
      slug: 'sans-crm',
      nom: 'Sans CRM',
      type: 'mandat',
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-taches-'));
    await writeFile(path.join(secretsDir, 'mandat-taches.env'), `HUBSPOT_TOKEN=${TOKEN}\n`);
    registerConnector(hubspotConnector({ fetch: portal.fetch, sleep: () => Promise.resolve() }));
    await sens('deux_sens');
    await syncConnexion(t.app.db, a, 'crm', off());
  });

  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    portal.calls.length = 0;
  });

  it('creates an OS task, typed from its title, without calling HubSpot', async () => {
    const tache = (await createTache(
      t.app.db,
      armed,
      { titre: 'Appeler Romain', hubspot: false },
      on(),
    )) as TacheVue;
    expect(tache).toMatchObject({ origine: 'os', canal: 'appel', fait: false });
    expect(portal.calls).toHaveLength(0);
  });

  it('creates a task in HubSpot first when asked, then its copy', async () => {
    const tache = (await createTache(
      t.app.db,
      armed,
      { titre: 'Envoyer la plaquette', notes: 'Version 2026', hubspot: true },
      on(),
    )) as TacheVue;
    expect(tache).toMatchObject({ origine: 'hubspot', canal: 'email', notes: 'Version 2026' });
    const post = portal.calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe('/crm/v3/objects/tasks');
    expect((post?.body as { properties: Record<string, string> }).properties).toMatchObject({
      hs_task_subject: 'Envoyer la plaquette',
      hs_task_body: 'Version 2026',
    });
  });

  it('simulates a HubSpot creation while writes are off, and refuses without a CRM', async () => {
    const avant = (await t.owner.pool.query('select 1 from taches')).rowCount;
    const simulee = await createTache(t.app.db, a, { titre: 'Relance', hubspot: true }, off());
    expect(simulee).toMatchObject({ simulation: true });
    expect((await t.owner.pool.query('select 1 from taches')).rowCount).toBe(avant);
    await expect(
      createTache(t.app.db, sansCrm, { titre: 'Relance', hubspot: true }, off()),
    ).rejects.toBeInstanceOf(CrmIndisponible);
  });

  it('updates an OS task freely: type from the new title, done, reopened, journaled', async () => {
    const tache = (await createTache(t.app.db, a, { titre: 'Préparer' }, off())) as TacheVue;
    const maj = (await updateTache(
      t.app.db,
      a,
      tache.id,
      { titre: 'Envoyer le devis', fait: true },
      off(),
    )) as TacheVue;
    expect(maj).toMatchObject({ canal: 'email', fait: true });
    expect(await row(tache.id)).toMatchObject({ titre: 'Envoyer le devis', canal: 'email' });
    await updateTache(t.app.db, a, tache.id, { fait: false }, off());
    expect((await row(tache.id))?.fait_at).toBeNull();
    expect(portal.calls).toHaveLength(0);
    const journal = await t.owner.pool.query<{ action: string }>(
      'select action from journal where instance_id = $1 order by id desc limit 1',
      [a.id],
    );
    expect(journal.rows[0]?.action).toMatch(/Tâche modifiée : Envoyer le devis/);
  });

  it('writes a HubSpot task change to HubSpot, or only simulates it while writes are off', async () => {
    const id = await hubspotTache('402');
    const avant = await row(id);
    const simulee = await updateTache(t.app.db, a, id, { titre: 'Envoyer le compte rendu' }, off());
    expect(simulee).toMatchObject({ simulation: true });
    expect(await row(id)).toEqual(avant);
    expect(portal.calls).toHaveLength(0);

    const reel = (await updateTache(
      t.app.db,
      armed,
      id,
      { titre: 'Envoyer le compte rendu', fait: false },
      on(),
    )) as TacheVue;
    expect(portal.calls.map((c) => [c.method, c.path])).toEqual([
      ['PATCH', '/crm/v3/objects/tasks/402'],
    ]);
    expect(reel).toMatchObject({ titre: 'Envoyer le compte rendu', canal: 'email', fait: false });
  });

  it('refuses to change a HubSpot task while the CRM is read-only', async () => {
    await sens('lecture');
    try {
      await expect(
        updateTache(t.app.db, armed, await hubspotTache('401'), { fait: true }, on()),
      ).rejects.toBeInstanceOf(CrmIndisponible);
    } finally {
      await sens('deux_sens');
    }
  });

  it('lists the week, overdue and undated open tasks, without meetings when no agenda', async () => {
    const mk = async (titre: string, echeance: string | null, fait = false) => {
      const tache = (await createTache(t.app.db, sansCrm, { titre, echeance }, off())) as TacheVue;
      if (fait) await updateTache(t.app.db, sansCrm, tache.id, { fait: true }, off());
    };
    await mk('Semaine', '2026-10-13T08:00:00.000Z');
    await mk('Retard', '2026-10-09T08:00:00.000Z');
    await mk('Retard faite', '2026-10-09T09:00:00.000Z', true);
    await mk('Sans date', null);
    await mk('Après', '2026-10-19T08:00:00.000Z');
    const vue = await listTaches(t.app.db, sansCrm, { du: '2026-10-12', au: '2026-10-18' }, off());
    expect(vue.taches.map((x) => x.titre)).toEqual(['Semaine']);
    expect(vue.enRetard.map((x) => x.titre)).toEqual(['Retard']);
    expect(vue.sansEcheance.map((x) => x.titre)).toEqual(['Sans date']);
    expect(vue).toMatchObject({ rdv: [], rdvEtat: 'non_configure', hubspot: false });
  });

  it('refuses to link a task to a contact or a deal of another instance', async () => {
    const { rows } = await t.owner.pool.query<{ id: string }>(
      'select id from contacts where instance_id = $1 limit 1',
      [a.id],
    );
    await expect(
      createTache(t.app.db, sansCrm, { titre: 'Appeler', contactId: rows[0]?.id }, off()),
    ).rejects.toThrow(/Contact introuvable dans cette instance/);
    const opp = await t.owner.pool.query<{ id: string }>(
      'select id from opportunites where instance_id = $1 limit 1',
      [a.id],
    );
    await expect(
      createTache(t.app.db, sansCrm, { titre: 'Appeler', opportuniteId: opp.rows[0]?.id }, off()),
    ).rejects.toThrow(/Opportunité introuvable dans cette instance/);
  });

  it('validates the API input and keeps each instance to itself', async () => {
    const app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
    try {
      const post = (slug: string, payload: Record<string, unknown>) =>
        app.inject({ method: 'POST', url: `/api/i/${slug}/taches`, payload });
      expect((await post('sans-crm', { titre: '  ' })).statusCode).toBe(400);
      expect((await post('sans-crm', { titre: 'X', echeance: 'demain' })).statusCode).toBe(400);
      const bad = await app.inject({
        method: 'GET',
        url: '/api/i/sans-crm/taches?du=2026-10-18&au=2026-10-12',
      });
      expect(bad.statusCode).toBe(400);
      const ok = await app.inject({
        method: 'GET',
        url: '/api/i/sans-crm/taches?du=2026-10-12&au=2026-10-18',
      });
      expect(ok.statusCode).toBe(200);

      const autre = await hubspotTache('401');
      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/i/sans-crm/taches/${autre}`,
        payload: { fait: true },
      });
      expect(patch.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
