import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../../test/database.js';
import { demoPortal, fakePortal, type PortalData } from '../../../test/hubspot-portal.js';
import {
  configureConnexion,
  registerConnector,
  syncConnexion,
  writeVia,
} from '../../connexions/service.js';
import { buildApp } from '../../app.js';
import { createEntreprise } from '../../crm/service.js';
import { withInstance } from '../../db/context.js';
import type { Instance } from '../../instances/schema.js';
import { createInstance } from '../../instances/service.js';
import { hubspotConnector } from './index.js';
import { mapContact, mapDeal, mapStages, mapTask } from './mapping.js';
import { EcritureRefusee } from './write.js';

const TOKEN = 'pat-eu1-fictif-0000';

describe('HubSpot mapping', () => {
  const etapes = mapStages(demoPortal().pipelines);

  it('maps closed stages to won and lost', () => {
    const [ouverte, gagnee, perdue] = demoPortal().deals.map((d) => mapDeal(d, etapes));
    expect(ouverte).toMatchObject({
      etape: 'qualifiedtobuy',
      clos: null,
      montant: 14000,
      echeance: '2026-11-15',
    });
    expect(gagnee).toMatchObject({ clos: 'gagne', montant: 22001 });
    expect(perdue).toMatchObject({ clos: 'perdu', motif: 'Budget reporté' });
  });

  it('reads custom pipelines through stage metadata', () => {
    const custom = mapStages([
      {
        id: 'p2',
        label: 'Export',
        stages: [
          {
            id: '9001',
            label: 'Signé',
            displayOrder: 1,
            metadata: { isClosed: 'true', probability: '1.0' },
          },
          {
            id: '9002',
            label: 'Abandonné',
            displayOrder: 2,
            metadata: { isClosed: 'true', probability: '0.0' },
          },
        ],
      },
    ]);
    expect(custom.map((e) => [e.id, e.clos, e.gagne])).toEqual([
      ['9001', true, true],
      ['9002', true, false],
    ]);
  });

  it('maps task types to channels and completion', () => {
    const [email, appel] = demoPortal().tasks.map(mapTask);
    expect(email).toMatchObject({ canal: 'email', faitAt: null });
    expect(appel?.canal).toBe('appel');
    expect(appel?.faitAt?.toISOString()).toBe('2026-10-06T10:00:00.000Z');
  });

  it('reads the task type from its title before the HubSpot type', () => {
    const t = mapTask({
      id: '9',
      properties: { hs_task_subject: 'Appeler Romain Arpin', hs_task_type: 'TODO' },
    });
    expect(t.canal).toBe('appel');
  });

  it('builds a contact name and keeps absent properties absent', () => {
    const c = mapContact({
      id: '1',
      properties: { firstname: 'Agathe', lastname: 'Vallière', email: 'a@b.example' },
    });
    expect(c).toEqual({ nom: 'Agathe Vallière', email: 'a@b.example', entrepriseSourceId: null });
    expect('telephone' in c).toBe(false);
  });
});

describe('HubSpot mirror', () => {
  let t: TestApp;
  let a: Instance;
  let secretsDir: string;
  let data: PortalData;
  let portal: ReturnType<typeof fakePortal>;

  const deps = () => ({ secretsDir, realWrites: false });
  const inA = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, a.id, fn);
  const count = async (table: string) =>
    (
      await t.owner.pool.query<{ n: number }>(
        `select count(*)::int as n from ${table} where instance_id = $1`,
        [a.id],
      )
    ).rows[0]?.n;
  const connexion = async () =>
    (
      await t.owner.pool.query<{
        etat: string;
        derniere_erreur: string | null;
        reglages: { etapes?: unknown[] };
      }>(
        "select etat, derniere_erreur, reglages from connexions where instance_id = $1 and kind = 'crm'",
        [a.id],
      )
    ).rows[0];

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, {
      slug: 'mandat-hubspot',
      nom: 'Mandat HubSpot',
      type: 'mandat',
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-hubspot-'));
    await writeFile(path.join(secretsDir, 'mandat-hubspot.env'), `HUBSPOT_TOKEN=${TOKEN}\n`);
    data = demoPortal();
    portal = fakePortal(data);
    registerConnector(hubspotConnector({ fetch: portal.fetch, sleep: () => Promise.resolve() }));
    await inA((tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { frequence: '15min', sens: 'deux_sens', champsExclus: ['phone'] },
      }),
    );
  });

  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    portal.calls.length = 0;
    portal.failWith(null);
  });

  it('mirrors companies, contacts, deals and tasks on the first full pass, with their links', async () => {
    const report = await syncConnexion(t.app.db, a, 'crm', deps());
    expect(report).toMatchObject({ lus: 10, crees: 10, maj: 0 });
    expect(await count('entreprises')).toBe(3);
    expect(await count('opportunites')).toBe(3);

    const { rows } = await t.owner.pool.query<{ contact: string; entreprise: string }>(
      `select c.nom as contact, e.nom as entreprise from contacts c join entreprises e on e.id = c.entreprise_id
       where c.instance_id = $1 order by c.nom`,
      [a.id],
    );
    expect(rows).toEqual([
      { contact: 'Agathe Vallière', entreprise: 'Fonderie Vallière' },
      { contact: 'Romain Arpin', entreprise: 'Menuiserie Arpin' },
    ]);
    const tache = await t.owner.pool.query<{ titre: string; opp: string }>(
      `select t.titre, o.titre as opp from taches t join opportunites o on o.id = t.opportunite_id where t.instance_id = $1`,
      [a.id],
    );
    expect(tache.rows).toEqual([
      { titre: 'Relancer Agathe Vallière', opp: 'Structuration commerciale' },
    ]);
    expect((await connexion())?.reglages.etapes).toHaveLength(5);
    expect(portal.calls.every((c) => !c.path.includes('/search'))).toBe(true);
  });

  it('only reads what changed on the next passes, and updates instead of duplicating', async () => {
    const company = data.companies[0];
    if (company) {
      company.properties.city = 'Annecy';
      company.properties.hs_lastmodifieddate = new Date(Date.now() + 60_000).toISOString();
    }
    const report = await syncConnexion(t.app.db, a, 'crm', deps());
    expect(report.crees).toBe(0);
    expect(report.lus).toBe(1);
    expect(portal.calls.some((c) => c.path === '/crm/v3/objects/companies/search')).toBe(true);
    const { rows } = await t.owner.pool.query<{ ville: string }>(
      "select ville from entreprises where instance_id = $1 and source_id = '101'",
      [a.id],
    );
    expect(rows[0]?.ville).toBe('Annecy');
    expect(await count('entreprises')).toBe(3);
  });

  it('vigilance 2: a persistent rate limit deletes nothing, shows the error, and the next pass recovers', async () => {
    const before = await count('contacts');
    portal.failWith(429);
    await expect(syncConnexion(t.app.db, a, 'crm', deps())).rejects.toThrow(/limite de débit/);
    expect(portal.calls).toHaveLength(3);
    expect(await count('contacts')).toBe(before);
    expect(await connexion()).toMatchObject({ etat: 'erreur' });
    expect((await connexion())?.derniere_erreur).toMatch(/429/);

    portal.failWith(null);
    await syncConnexion(t.app.db, a, 'crm', deps());
    expect(await connexion()).toMatchObject({ etat: 'ok', derniere_erreur: null });
  });

  it('vigilance 3: an excluded field is neither read nor overwritten nor written', async () => {
    await t.owner.pool.query(
      "update contacts set telephone = '06 00 00 00 00' where instance_id = $1 and source_id = '201'",
      [a.id],
    );
    const contact = data.contacts[0];
    if (contact)
      contact.properties.hs_lastmodifieddate = new Date(Date.now() + 120_000).toISOString();
    await syncConnexion(t.app.db, a, 'crm', deps());

    const read = portal.calls.find((c) => c.path === '/crm/v3/objects/contacts/search');
    expect((read?.body as { properties: string[] }).properties).not.toContain('phone');
    const { rows } = await t.owner.pool.query<{ id: string; telephone: string }>(
      "select id, telephone from contacts where instance_id = $1 and source_id = '201'",
      [a.id],
    );
    expect(rows[0]?.telephone).toBe('06 00 00 00 00');

    portal.calls.length = 0;
    const armed = { ...a, config: { ecrituresReelles: true } };
    await inA((tx) =>
      writeVia(
        tx,
        armed,
        'crm',
        {
          op: 'contact.update',
          data: { contactId: rows[0]?.id, telephone: '07 11', fonction: 'PDG' },
        },
        { secretsDir, realWrites: true },
      ),
    );
    const patch = portal.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ properties: { jobtitle: 'PDG' } });
  });

  it('simulates without any HTTP call unless both locks are on, and journals the simulation', async () => {
    const { rows } = await t.owner.pool.query<{ id: string }>(
      "select id from opportunites where instance_id = $1 and source_id = '301'",
      [a.id],
    );
    const op = {
      op: 'deal.stage',
      data: { opportuniteId: rows[0]?.id, etape: 'presentationscheduled' },
    };
    const result = await inA((tx) => writeVia(tx, a, 'crm', op, deps()));
    expect(result).toMatchObject({ simulation: true });
    expect(portal.calls).toHaveLength(0);
    const journal = await t.owner.pool.query<{ action: string }>(
      'select action from journal where instance_id = $1 order by id desc limit 1',
      [a.id],
    );
    expect(journal.rows[0]?.action).toMatch(/Simulation/);

    const armed = { ...a, config: { ecrituresReelles: true } };
    const real = await inA((tx) =>
      writeVia(tx, armed, 'crm', op, { secretsDir, realWrites: true }),
    );
    expect(real).toMatchObject({ simulation: false });
    expect(portal.calls).toEqual([
      {
        method: 'PATCH',
        path: '/crm/v3/objects/deals/301',
        body: { properties: { dealstage: 'presentationscheduled' } },
      },
    ]);
  });

  it('reads task notes and updates a task in HubSpot with only the given fields', async () => {
    const tache = data.tasks[0];
    if (tache) {
      tache.properties.hs_task_body = 'Rappeler avant midi';
      tache.properties.hs_lastmodifieddate = new Date(Date.now() + 240_000).toISOString();
    }
    await syncConnexion(t.app.db, a, 'crm', deps());
    const { rows } = await t.owner.pool.query<{ id: string; notes: string | null }>(
      "select id, notes from taches where instance_id = $1 and source_id = '401'",
      [a.id],
    );
    expect(rows[0]?.notes).toBe('Rappeler avant midi');
    const tacheId = rows[0]?.id;

    portal.calls.length = 0;
    const simulee = await inA((tx) =>
      writeVia(tx, a, 'crm', { op: 'task.update', data: { tacheId, fait: true } }, deps()),
    );
    expect(simulee).toMatchObject({ simulation: true });
    expect(portal.calls).toHaveLength(0);

    const armed = { ...a, config: { ecrituresReelles: true } };
    const reel = { secretsDir, realWrites: true };
    const update = (d: Record<string, unknown>) =>
      inA((tx) => writeVia(tx, armed, 'crm', { op: 'task.update', data: { tacheId, ...d } }, reel));
    await update({ titre: 'Appeler Agathe', fait: true });
    await update({ fait: false, echeance: '2026-10-12T08:30:00.000Z', notes: '' });
    expect(portal.calls).toEqual([
      {
        method: 'PATCH',
        path: '/crm/v3/objects/tasks/401',
        body: { properties: { hs_task_subject: 'Appeler Agathe', hs_task_status: 'COMPLETED' } },
      },
      {
        method: 'PATCH',
        path: '/crm/v3/objects/tasks/401',
        body: {
          properties: {
            hs_task_status: 'NOT_STARTED',
            hs_timestamp: '2026-10-12T08:30:00.000Z',
            hs_task_body: '',
          },
        },
      },
    ]);

    const natif = await t.owner.pool.query<{ id: string }>(
      "insert into taches (instance_id, titre, canal) values ($1, 'Tâche OS', 'tache') returning id",
      [a.id],
    );
    await expect(update({ tacheId: natif.rows[0]?.id, fait: true })).rejects.toThrow(
      /n'existe pas dans HubSpot/,
    );
  });

  it('creates a company in HubSpot first, then its copy; in simulation, creates nothing', async () => {
    const before = (await count('entreprises')) ?? 0;
    const simulated = await createEntreprise(t.app.db, a, { nom: 'Scierie Bonnet' }, deps());
    expect(simulated).toMatchObject({ simulation: true });
    expect(await count('entreprises')).toBe(before);
    expect(portal.calls).toHaveLength(0);

    const armed = { ...a, config: { ecrituresReelles: true } };
    const created = await createEntreprise(
      t.app.db,
      armed,
      { nom: 'Scierie Bonnet', ville: 'Thônes' },
      {
        secretsDir,
        realWrites: true,
      },
    );
    expect(created).toMatchObject({ nom: 'Scierie Bonnet', source: 'hubspot' });
    expect(portal.calls).toEqual([
      {
        method: 'POST',
        path: '/crm/v3/objects/companies',
        body: { properties: { name: 'Scierie Bonnet', city: 'Thônes' } },
      },
    ]);
    expect(await count('entreprises')).toBe(before + 1);
  });

  it('refuses any write when the CRM is mirrored read-only', async () => {
    await inA((tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'lecture' },
      }),
    );
    await expect(
      inA((tx) => writeVia(tx, a, 'crm', { op: 'deal.stage', data: {} }, deps())),
    ).rejects.toBeInstanceOf(EcritureRefusee);
  });

  it('serves the settings screen without ever sending the token, and saves the settings', async () => {
    const app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/i/mandat-hubspot/connexions' });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(TOKEN);
      expect(res.json()).toMatchObject({
        connexions: [
          { kind: 'crm', fournisseur: 'hubspot', secret: { nom: 'HUBSPOT_TOKEN', present: true } },
        ],
        ecrituresReelles: false,
      });

      const bad = await app.inject({
        method: 'PATCH',
        url: '/api/i/mandat-hubspot/connexions/crm',
        payload: { sens: 'partout' },
      });
      expect(bad.statusCode).toBe(400);
      const saved = await app.inject({
        method: 'PATCH',
        url: '/api/i/mandat-hubspot/connexions/crm',
        payload: { frequence: '1h', champsExclus: ['phone', 'annualrevenue'] },
      });
      expect(saved.json()).toMatchObject({
        reglages: { frequence: '1h', champsExclus: ['phone', 'annualrevenue'] },
      });

      const sync = await app.inject({
        method: 'POST',
        url: '/api/i/mandat-hubspot/connexions/crm/sync',
      });
      expect(sync.statusCode).toBe(200);
      expect(sync.json()).toHaveProperty('lus');
    } finally {
      await app.close();
    }
  });

  it('leaves out excluded email domains: removes their copies, skips them, brings them back', async () => {
    const app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
    const mirrored = async (table: string, sourceId: string) =>
      (
        await t.owner.pool.query(
          `select 1 from ${table} where instance_id = $1 and source = 'hubspot' and source_id = $2`,
          [a.id, sourceId],
        )
      ).rowCount;
    const patch = (domainesExclus: string[]) =>
      app.inject({
        method: 'PATCH',
        url: '/api/i/mandat-hubspot/connexions/crm',
        payload: { domainesExclus },
      });
    try {
      expect(await mirrored('contacts', '202')).toBe(1);
      const refused = await patch(['pas un domaine']);
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toEqual({
        error: 'Un domaine de la liste est invalide (exemple attendu : ma-banque.fr).',
      });

      const saved = await patch(['https://www.Menuiserie-Arpin.example/contact']);
      expect(saved.json()).toMatchObject({
        reglages: { domainesExclus: ['menuiserie-arpin.example'] },
      });
      expect(await mirrored('contacts', '202')).toBe(0);
      expect(await mirrored('entreprises', '102')).toBe(0);
      const deal = await t.owner.pool.query<{ entreprise_id: string | null }>(
        "select entreprise_id, contact_id from opportunites where instance_id = $1 and source_id = '302'",
        [a.id],
      );
      expect(deal.rows[0]).toEqual({ entreprise_id: null, contact_id: null });
      const journal = await t.owner.pool.query<{ action: string }>(
        'select action from journal where instance_id = $1 order by id desc limit 1',
        [a.id],
      );
      expect(journal.rows[0]?.action).toMatch(/2 fiches retirées de la copie/);

      await t.owner.pool.query(
        "update connexions set derniere_synchro = null where instance_id = $1 and kind = 'crm'",
        [a.id],
      );
      await syncConnexion(t.app.db, a, 'crm', deps());
      expect(await mirrored('contacts', '202')).toBe(0);
      expect(await mirrored('entreprises', '102')).toBe(0);
      expect(await mirrored('contacts', '201')).toBe(1);

      // A mirrored contact whose email moves to an excluded domain leaves the copy too.
      const agathe = data.contacts[0];
      if (agathe) {
        agathe.properties.email = 'agathe@menuiserie-arpin.example';
        agathe.properties.hs_lastmodifieddate = new Date(Date.now() + 180_000).toISOString();
      }
      await syncConnexion(t.app.db, a, 'crm', deps());
      expect(await mirrored('contacts', '201')).toBe(0);

      await patch([]);
      await syncConnexion(t.app.db, a, 'crm', deps());
      expect(await mirrored('contacts', '202')).toBe(1);
      expect(await mirrored('entreprises', '102')).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('explains a missing token without leaking any secret', async () => {
    const other = await createInstance(t.owner.db, {
      slug: 'sans-jeton',
      nom: 'Sans jeton',
      type: 'mandat',
    });
    await withInstance(t.app.db, other.id, (tx) =>
      configureConnexion(tx, { kind: 'crm', fournisseur: 'hubspot', reglages: {} }),
    );
    await expect(syncConnexion(t.app.db, other, 'crm', deps())).rejects.toThrow(
      /HUBSPOT_TOKEN dans secrets\/instances\/sans-jeton\.env/,
    );
    await expect(syncConnexion(t.app.db, other, 'crm', deps())).rejects.not.toThrow(TOKEN);
  });
});
