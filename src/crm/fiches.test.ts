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
import { ajouterNote, getFiche, updateFiche, type Fiche } from './fiches.js';
import { createEntreprise, CrmIndisponible } from './service.js';

const TOKEN = 'pat-eu1-fictif-0000';

describe('Fiches détaillées', () => {
  let t: TestApp;
  let a: Instance;
  let armed: Instance;
  let natif: Instance;
  let secretsDir: string;
  const portal = fakePortal(demoPortal());
  const off = () => ({ secretsDir, realWrites: false });
  const on = () => ({ secretsDir, realWrites: true });
  const id = async (table: string, sourceId: string) =>
    (
      await t.owner.pool.query<{ id: string }>(
        `select id from ${table} where instance_id = $1 and source_id = $2`,
        [a.id, sourceId],
      )
    ).rows[0]?.id ?? '';
  const mercredi = new Date('2026-10-14T10:00:00Z');

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'mandat-fiches', nom: 'M', type: 'mandat' });
    armed = { ...a, config: { ecrituresReelles: true } };
    natif = await createInstance(t.owner.db, { slug: 'fiches-os', nom: 'OS', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-fiches-'));
    await writeFile(path.join(secretsDir, 'mandat-fiches.env'), `HUBSPOT_TOKEN=${TOKEN}\n`);
    registerConnector(hubspotConnector({ fetch: portal.fetch, sleep: () => Promise.resolve() }));
    await withInstance(t.app.db, a.id, (tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'deux_sens' },
      }),
    );
    await syncConnexion(t.app.db, a, 'crm', off());
  });

  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    portal.calls.length = 0;
  });

  it('shows a deal: links, next activities, history with stage changes, days per stage', async () => {
    const f = (await getFiche(t.app.db, a, 'affaire', await id('opportunites', '301'), mercredi))!;
    expect(f.fiche).toMatchObject({ titre: 'Structuration commerciale', origine: 'hubspot' });
    expect(f.liens).toMatchObject({
      entreprise: { nom: 'Fonderie Vallière' },
      contact: { nom: 'Agathe Vallière' },
    });
    expect(f.aVenir.map((x) => x.titre)).toEqual(['Relancer Agathe Vallière']);
    expect(f.historique.map((e) => [e.type, e.titre ?? e.texte])).toEqual([
      ['note', 'Point & suivi : budget validé !'],
      ['etape', 'Qualifié'],
      ['etape', 'Rendez-vous planifié'],
    ]);
    expect(f.etapes?.filter((e) => e.jours !== null).map((e) => [e.id, e.jours])).toEqual([
      ['appointmentscheduled', 11],
      ['qualifiedtobuy', 13],
    ]);
  });

  it('shows a contact and a company with their deals, contacts and merged history', async () => {
    const romain = (await getFiche(t.app.db, a, 'contact', await id('contacts', '202')))!;
    expect(romain.historique.map((e) => e.type)).toContain('appel');
    expect(romain.liens.affaires?.map((o) => o.titre)).toEqual(['Accompagnement export']);

    const fonderie = (await getFiche(t.app.db, a, 'entreprise', await id('entreprises', '101')))!;
    expect(fonderie.liens.contacts?.map((c) => c.nom)).toEqual(['Agathe Vallière']);
    const types = fonderie.historique.map((e) => e.type);
    expect(types.filter((x) => x === 'note')).toHaveLength(1);
    expect(types).toContain('reunion');
    expect(types).toContain('email');
  });

  it('writes a HubSpot deal change to HubSpot first, or only simulates it', async () => {
    const opp = await id('opportunites', '301');
    const simulee = await updateFiche(t.app.db, a, 'affaire', opp, { montant: 18000 }, off());
    expect(simulee).toMatchObject({ simulation: true });
    expect(portal.calls).toHaveLength(0);

    const f = (await updateFiche(
      t.app.db,
      armed,
      'affaire',
      opp,
      { titre: 'Structuration 2027', montant: 18000 },
      on(),
    )) as Fiche;
    expect(portal.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'PATCH /crm/v3/objects/deals/301',
    ]);
    expect(f.fiche).toMatchObject({ titre: 'Structuration 2027', montant: 18000 });
  });

  it('refuses changes to HubSpot records while the CRM is read-only', async () => {
    await withInstance(t.app.db, a.id, (tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'lecture' },
      }),
    );
    try {
      await expect(
        updateFiche(
          t.app.db,
          armed,
          'contact',
          await id('contacts', '201'),
          { fonction: 'X' },
          on(),
        ),
      ).rejects.toBeInstanceOf(CrmIndisponible);
    } finally {
      await withInstance(t.app.db, a.id, (tx) =>
        configureConnexion(tx, {
          kind: 'crm',
          fournisseur: 'hubspot',
          reglages: { sens: 'deux_sens' },
        }),
      );
    }
  });

  it('adds a note in HubSpot with the deal links, or only in the OS', async () => {
    const opp = await id('opportunites', '301');
    const f = (await ajouterNote(
      t.app.db,
      armed,
      'affaire',
      opp,
      { corps: 'Devis envoyé', hubspot: true },
      on(),
    )) as Fiche;
    const post = portal.calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe('/crm/v3/objects/notes');
    expect((post?.body as { associations: unknown[] }).associations).toHaveLength(3);
    expect(f.historique[0]).toMatchObject({
      type: 'note',
      texte: 'Devis envoyé',
      origine: 'hubspot',
    });

    portal.calls.length = 0;
    const local = (await ajouterNote(
      t.app.db,
      a,
      'affaire',
      opp,
      { corps: 'Pense-bête', hubspot: false },
      off(),
    )) as Fiche;
    expect(portal.calls).toHaveLength(0);
    expect(local.historique[0]).toMatchObject({ texte: 'Pense-bête', origine: 'os' });
  });

  it('edits an OS company freely, and keeps each instance to itself', async () => {
    const e = (await createEntreprise(t.app.db, natif, { nom: 'Scierie Bonnet' }, off())) as {
      id: string;
    };
    const f = (await updateFiche(
      t.app.db,
      natif,
      'entreprise',
      e.id,
      { ville: 'Thônes', secteur: 'Bois', taille: 12 },
      off(),
    )) as Fiche;
    expect(f.fiche).toMatchObject({ ville: 'Thônes', secteur: 'Bois', taille: 12 });
    expect(await getFiche(t.app.db, a, 'entreprise', e.id)).toBeNull();

    const app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
    try {
      const autre = await app.inject({
        method: 'GET',
        url: `/api/i/mandat-fiches/fiches/entreprise/${e.id}`,
      });
      expect(autre.statusCode).toBe(404);
      const mauvais = await app.inject({
        method: 'GET',
        url: `/api/i/fiches-os/fiches/devis/${e.id}`,
      });
      expect(mauvais.statusCode).toBe(404);
      const invalide = await app.inject({
        method: 'PATCH',
        url: `/api/i/fiches-os/fiches/entreprise/${e.id}`,
        payload: { taille: -3 },
      });
      expect(invalide.statusCode).toBe(400);
      const ok = await app.inject({
        method: 'POST',
        url: `/api/i/fiches-os/fiches/entreprise/${e.id}/notes`,
        payload: { corps: 'Premier contact au salon' },
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('searches deals, people and organisations at once, for the global search', async () => {
    const app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
    try {
      const r = await app.inject({ method: 'GET', url: '/api/i/mandat-fiches/recherche?q=vall' });
      expect(r.json()).toMatchObject({
        organisations: [{ nom: 'Fonderie Vallière' }],
        personnes: [{ nom: 'Agathe Vallière', entreprise: 'Fonderie Vallière' }],
      });
      const affaires = await app.inject({
        method: 'GET',
        url: '/api/i/mandat-fiches/recherche?q=export',
      });
      expect(affaires.json()).toMatchObject({
        affaires: [{ titre: 'Accompagnement export' }],
      });
      const court = await app.inject({ method: 'GET', url: '/api/i/mandat-fiches/recherche?q=v' });
      expect(court.json()).toEqual({ affaires: [], personnes: [], organisations: [] });
    } finally {
      await app.close();
    }
  });
});
