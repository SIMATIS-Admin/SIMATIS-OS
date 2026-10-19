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
import { compterAFaire, createTache, listTaches, updateTache, type TacheVue } from './taches.js';

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

  it('links a task to a person or a company chosen in the OS, and unlinks it', async () => {
    const { rows } = await t.owner.pool.query<{ id: string }>(
      "insert into entreprises (instance_id, nom) values ($1, 'Atelier fictif') returning id",
      [sansCrm.id],
    );
    const entrepriseId = rows[0]?.id ?? '';
    // Due long after the weeks the other tests read.
    const tache = (await createTache(
      t.app.db,
      sansCrm,
      { titre: 'Relancer', echeance: '2027-03-01T08:00:00.000Z' },
      off(),
    )) as TacheVue;
    const liee = (await updateTache(
      t.app.db,
      sansCrm,
      tache.id,
      { entrepriseId },
      off(),
    )) as TacheVue;
    expect(liee.entreprise).toEqual({ id: entrepriseId, nom: 'Atelier fictif' });
    const deliee = (await updateTache(
      t.app.db,
      sansCrm,
      tache.id,
      { entrepriseId: null },
      off(),
    )) as TacheVue;
    expect(deliee.entreprise).toBeNull();
    await expect(
      updateTache(
        t.app.db,
        sansCrm,
        tache.id,
        { contactId: '00000000-0000-4000-8000-000000000000' },
        off(),
      ),
    ).rejects.toThrow(/Contact introuvable dans cette instance/);
  });

  it('sends a HubSpot task its new company, and the sync keeps the link chosen in the OS', async () => {
    const id = await hubspotTache('402');
    const avant = await t.owner.pool.query<{ contact_id: string | null }>(
      'select contact_id from taches where id = $1',
      [id],
    );
    const { rows } = await t.owner.pool.query<{ id: string; source_id: string }>(
      "select id, source_id from entreprises where instance_id = $1 and source = 'hubspot' and nom <> 'Menuiserie Arpin' limit 1",
      [a.id],
    );
    const entreprise = rows[0];
    if (!entreprise) throw new Error('pas d’entreprise HubSpot de démo');
    const reel = (await updateTache(
      t.app.db,
      armed,
      id,
      { entrepriseId: entreprise.id, contactId: null },
      on(),
    )) as TacheVue;
    expect(portal.calls.map((c) => [c.method, c.path])).toEqual([
      ['PUT', `/crm/v4/objects/tasks/402/associations/default/companies/${entreprise.source_id}`],
    ]);
    expect(reel.entreprise?.id).toBe(entreprise.id);
    expect(reel.contact).toBeNull();

    await syncConnexion(t.app.db, a, 'crm', off());
    const apres = await t.owner.pool.query<{ contact_id: string | null; entreprise_id: string }>(
      'select contact_id, entreprise_id from taches where id = $1',
      [id],
    );
    expect(apres.rows[0]).toEqual({ contact_id: null, entreprise_id: entreprise.id });
    // Back to the HubSpot links for the other tests.
    await t.owner.pool.query(
      'update taches set contact_id = $2, entreprise_id = null, lien_choisi = false where id = $1',
      [id, avant.rows[0]?.contact_id],
    );
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
    const mercredi = new Date('2026-10-14T10:00:00Z');
    const vue = await listTaches(
      t.app.db,
      sansCrm,
      { du: '2026-10-12', au: '2026-10-18' },
      off(),
      mercredi,
    );
    expect(vue.taches.map((x) => x.titre)).toEqual(['Semaine']);
    expect(vue.enRetard.map((x) => x.titre)).toEqual(['Retard']);
    expect(vue.sansEcheance.map((x) => x.titre)).toEqual(['Sans date']);
    expect(vue).toMatchObject({ rdv: [], rdvEtat: 'non_configure', hubspot: false });

    // Overdue means before today, not before the week shown: viewing a later week, the task
    // of the 19th (future) is not overdue, the one of the 13th (past) is.
    const plusTard = await listTaches(
      t.app.db,
      sansCrm,
      { du: '2026-10-26', au: '2026-11-01' },
      off(),
      mercredi,
    );
    expect(plusTard.enRetard.map((x) => x.titre)).toEqual(['Retard', 'Semaine']);
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

  it('creates a Pipedrive-like activity, sending HubSpot only what it knows', async () => {
    const tache = (await createTache(
      t.app.db,
      armed,
      {
        titre: 'Point mensuel',
        type: 'reunion',
        avecHeure: true,
        dureeMinutes: 60,
        occupe: true,
        echeance: '2026-10-15T12:00:00.000Z',
        hubspot: true,
      },
      on(),
    )) as TacheVue;
    expect(tache).toMatchObject({
      type: 'reunion',
      canal: 'tache',
      avecHeure: true,
      dureeMinutes: 60,
      occupe: true,
    });
    const props = (
      portal.calls.find((c) => c.method === 'POST')?.body as {
        properties: Record<string, string>;
      }
    ).properties;
    expect(props.hs_task_type).toBe('TODO');
    expect(JSON.stringify(props)).not.toMatch(/60|occup|duree/i);
    const choisi = await t.owner.pool.query<{ type_choisi: boolean }>(
      'select type_choisi from taches where id = $1',
      [tache.id],
    );
    expect(choisi.rows[0]?.type_choisi).toBe(true);

    const devine = (await createTache(t.app.db, a, { titre: 'Appeler Agathe' }, off())) as TacheVue;
    expect(devine.type).toBe('appel');
    const libre = await t.owner.pool.query<{ type_choisi: boolean }>(
      'select type_choisi from taches where id = $1',
      [devine.id],
    );
    expect(libre.rows[0]?.type_choisi).toBe(false);
  });

  it('stamps the deal last activity when a linked activity is done', async () => {
    const opp = (
      await t.owner.pool.query<{ id: string }>(
        "select id from opportunites where instance_id = $1 and source_id = '301'",
        [a.id],
      )
    ).rows[0]?.id;
    await t.owner.pool.query('update opportunites set derniere_activite = null where id = $1', [
      opp,
    ]);
    const tache = (await createTache(
      t.app.db,
      a,
      { titre: 'Préparer la proposition', opportuniteId: opp },
      off(),
    )) as TacheVue;
    expect(tache.opportunite).toMatchObject({ id: opp, clos: null });
    await updateTache(t.app.db, a, tache.id, { fait: true }, off());
    const { rows } = await t.owner.pool.query<{ derniere_activite: Date | null }>(
      'select derniere_activite from opportunites where id = $1',
      [opp],
    );
    expect(rows[0]?.derniere_activite).not.toBeNull();
  });

  it('counts open activities overdue or due today, for the menu badge', async () => {
    const vide = await createInstance(t.owner.db, { slug: 'compteur', nom: 'C', type: 'mandat' });
    const mercredi = new Date('2026-10-14T10:00:00Z');
    expect(await compterAFaire(t.app.db, vide, mercredi)).toBe(0);
    for (const [titre, echeance] of [
      ['Hier', '2026-10-13T08:00:00.000Z'],
      ['Ce soir', '2026-10-14T19:00:00.000Z'],
      ['Demain', '2026-10-15T08:00:00.000Z'],
    ] as const) {
      await createTache(t.app.db, vide, { titre, echeance }, off());
    }
    const faite = (await createTache(
      t.app.db,
      vide,
      { titre: 'Faite', echeance: '2026-10-13T08:00:00.000Z' },
      off(),
    )) as TacheVue;
    await updateTache(t.app.db, vide, faite.id, { fait: true }, off());
    expect(await compterAFaire(t.app.db, vide, mercredi)).toBe(2);
  });

  it('gives each activity its person details and organisation, and searches deals to link', async () => {
    const tache = await t.owner.pool.query<{ id: string }>(
      "select id from taches where instance_id = $1 and source_id = '402'",
      [a.id],
    );
    const vue = await listTaches(t.app.db, a, { du: '2026-10-01', au: '2026-10-31' }, off());
    const appel = [...vue.taches, ...vue.enRetard].find((x) => x.id === tache.rows[0]?.id);
    expect(appel?.contact).toMatchObject({
      nom: 'Romain Arpin',
      email: 'r.arpin@menuiserie-arpin.example',
    });
    expect(appel?.entreprise).toMatchObject({ nom: 'Menuiserie Arpin' });

    const app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
    try {
      const r = await app.inject({
        method: 'GET',
        url: '/api/i/mandat-taches/opportunites/recherche?q=struct',
      });
      expect(r.json()).toEqual([
        expect.objectContaining({
          titre: 'Structuration commerciale',
          entreprise: 'Fonderie Vallière',
        }),
      ]);
    } finally {
      await app.close();
    }
  });

  it('validates the API input and keeps each instance to itself', async () => {
    const app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
    try {
      const post = (slug: string, payload: Record<string, unknown>) =>
        app.inject({ method: 'POST', url: `/api/i/${slug}/taches`, payload });
      expect((await post('sans-crm', { titre: '  ' })).statusCode).toBe(400);
      expect((await post('sans-crm', { titre: 'X', echeance: 'demain' })).statusCode).toBe(400);
      expect((await post('sans-crm', { titre: 'X', dureeMinutes: 5 })).statusCode).toBe(400);
      expect((await post('sans-crm', { titre: 'X', type: 'apero' })).statusCode).toBe(400);
      const compteur = await app.inject({ method: 'GET', url: '/api/i/sans-crm/taches/compteur' });
      expect(compteur.json()).toHaveProperty('n');

      const prefs = await app.inject({ method: 'GET', url: '/api/preferences' });
      expect(prefs.json()).toMatchObject({ options: { ensuite: true } });
      await app.inject({
        method: 'PUT',
        url: '/api/preferences/options',
        payload: { ensuite: false },
      });
      const relues = await app.inject({ method: 'GET', url: '/api/preferences' });
      expect(relues.json()).toMatchObject({ options: { ensuite: false } });
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
