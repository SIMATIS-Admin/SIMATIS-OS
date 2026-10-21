import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { demoPortal, fakePortal } from '../../test/hubspot-portal.js';
import { hubspotConnector } from '../connecteurs/hubspot/index.js';
import { configureConnexion, registerConnector, syncConnexion } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { FicheInvalide } from './fiches.js';
import {
  definirPrincipal,
  delierFiches,
  lierFiches,
  lireLiens,
  reparerPrincipaux,
} from './liens.js';
import { CrmIndisponible } from './service.js';

const TOKEN = 'pat-eu1-fictif-0000';

describe('Liens entre fiches', () => {
  let t: TestApp;
  let natif: Instance;
  let autre: Instance;
  let hub: Instance;
  let lecture: Instance;
  let secretsDir: string;
  const portal = fakePortal(demoPortal());
  const off = () => ({ secretsDir, realWrites: false });
  const on = () => ({ secretsDir, realWrites: true });

  const insere = async (i: Instance, table: string, colonnes: string, valeurs: unknown[]) =>
    (
      await t.owner.pool.query<{ id: string }>(
        `insert into ${table} (instance_id, ${colonnes}) values ($1, ${valeurs.map((_, n) => `$${n + 2}`).join(', ')}) returning id`,
        [i.id, ...valeurs],
      )
    ).rows[0]?.id as string;
  const contact = (i: Instance, nom: string, source?: string, sourceId?: string) =>
    insere(i, 'contacts', 'nom, source, source_id', [nom, source ?? 'natif', sourceId ?? null]);
  const entreprise = (i: Instance, nom: string) => insere(i, 'entreprises', 'nom', [nom]);
  const affaire = (i: Instance, titre: string, source?: string, sourceId?: string) =>
    insere(i, 'opportunites', 'titre, etape, source, source_id', [
      titre,
      'qualification',
      source ?? 'natif',
      sourceId ?? null,
    ]);
  const colonne = async (table: string, col: string, id: string) =>
    (
      await t.owner.pool.query<{ v: string | null }>(
        `select ${col} as v from ${table} where id = $1`,
        [id],
      )
    ).rows[0]?.v ?? null;
  const nbLiens = async (table: string) =>
    (await t.owner.pool.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]
      ?.n ?? 0;
  const hubspotId = async (table: string, sourceId: string) =>
    (
      await t.owner.pool.query<{ id: string }>(
        `select id from ${table} where instance_id = $1 and source_id = $2`,
        [hub.id, sourceId],
      )
    ).rows[0]?.id as string;

  beforeAll(async () => {
    t = await setupTestApp();
    natif = await createInstance(t.owner.db, { slug: 'liens-os', nom: 'OS', type: 'mandat' });
    autre = await createInstance(t.owner.db, { slug: 'liens-autre', nom: 'Autre', type: 'mandat' });
    hub = await createInstance(t.owner.db, { slug: 'liens-hub', nom: 'Hub', type: 'mandat' });
    lecture = await createInstance(t.owner.db, { slug: 'liens-lecture', nom: 'L', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-liens-'));
    await writeFile(path.join(secretsDir, 'liens-hub.env'), `HUBSPOT_TOKEN=${TOKEN}\n`);
    await writeFile(path.join(secretsDir, 'liens-lecture.env'), `HUBSPOT_TOKEN=${TOKEN}\n`);
    registerConnector(hubspotConnector({ fetch: portal.fetch, sleep: () => Promise.resolve() }));
    for (const [i, sens] of [
      [hub, 'deux_sens'],
      [lecture, 'lecture'],
    ] as const) {
      await withInstance(t.app.db, i.id, (tx) =>
        configureConnexion(tx, { kind: 'crm', fournisseur: 'hubspot', reglages: { sens } }),
      );
    }
    await syncConnexion(t.app.db, hub, 'crm', off());
  });

  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    portal.calls.length = 0;
    portal.failWith(null);
  });

  it('lie, garde le premier lien comme principal et ne crée pas de doublon', async () => {
    const a = await affaire(natif, 'Affaire fictive A');
    const c1 = await contact(natif, 'Personne Un');
    const c2 = await contact(natif, 'Personne Deux');
    expect(
      await lierFiches(
        t.app.db,
        natif,
        { kind: 'affaire', id: a },
        { kind: 'contact', id: c1 },
        off(),
      ),
    ).toEqual({ ok: true });
    await lierFiches(
      t.app.db,
      natif,
      { kind: 'contact', id: c2 },
      { kind: 'affaire', id: a },
      off(),
    );
    await lierFiches(
      t.app.db,
      natif,
      { kind: 'affaire', id: a },
      { kind: 'contact', id: c2 },
      off(),
    );

    expect(await colonne('opportunites', 'contact_id', a)).toBe(c1);
    const liens = await withInstance(t.app.db, natif.id, (tx) => lireLiens(tx, 'affaire', a));
    expect(liens.contacts.map((l) => [l.nom, l.principal])).toEqual([
      ['Personne Un', true],
      ['Personne Deux', false],
    ]);
    const vue = await withInstance(t.app.db, natif.id, (tx) => lireLiens(tx, 'contact', c1));
    expect(vue.affaires.map((l) => l.nom)).toEqual(['Affaire fictive A']);
  });

  it('change de principal puis le promeut automatiquement quand on le délie', async () => {
    const a = await affaire(natif, 'Affaire fictive B');
    const e1 = await entreprise(natif, 'Organisation Une');
    const e2 = await entreprise(natif, 'Organisation Deux');
    const ref = (id: string) => ({ kind: 'entreprise' as const, id });
    const aff = { kind: 'affaire' as const, id: a };
    await lierFiches(t.app.db, natif, aff, ref(e1), off());
    await lierFiches(t.app.db, natif, aff, ref(e2), off());

    await definirPrincipal(t.app.db, natif, aff, ref(e2));
    expect(await colonne('opportunites', 'entreprise_id', a)).toBe(e2);

    await delierFiches(t.app.db, natif, aff, ref(e2), off());
    expect(await colonne('opportunites', 'entreprise_id', a)).toBe(e1);
    const liens = await withInstance(t.app.db, natif.id, (tx) => lireLiens(tx, 'affaire', a));
    expect(liens.entreprises.map((l) => [l.nom, l.principal])).toEqual([
      ['Organisation Une', true],
    ]);

    await delierFiches(t.app.db, natif, aff, ref(e1), off());
    expect(await colonne('opportunites', 'entreprise_id', a)).toBeNull();
  });

  it('lie une personne à plusieurs organisations', async () => {
    const c = await contact(natif, 'Personne Trois');
    const e1 = await entreprise(natif, 'Organisation Trois');
    const e2 = await entreprise(natif, 'Organisation Quatre');
    for (const e of [e1, e2])
      await lierFiches(
        t.app.db,
        natif,
        { kind: 'contact', id: c },
        { kind: 'entreprise', id: e },
        off(),
      );
    expect(await colonne('contacts', 'entreprise_id', c)).toBe(e1);
    const vue = await withInstance(t.app.db, natif.id, (tx) => lireLiens(tx, 'entreprise', e2));
    expect(vue.contacts.map((l) => l.nom)).toEqual(['Personne Trois']);
  });

  it('refuse une paire impossible, des fiches inconnues et une fiche d’une autre instance', async () => {
    const c1 = await contact(natif, 'Personne Quatre');
    const c2 = await contact(natif, 'Personne Cinq');
    await expect(
      lierFiches(t.app.db, natif, { kind: 'contact', id: c1 }, { kind: 'contact', id: c2 }, off()),
    ).rejects.toBeInstanceOf(FicheInvalide);
    const etrangere = await entreprise(autre, 'Organisation étrangère');
    await expect(
      lierFiches(
        t.app.db,
        natif,
        { kind: 'contact', id: c1 },
        { kind: 'entreprise', id: etrangere },
        off(),
      ),
    ).rejects.toThrow(/introuvable dans cette instance/);
    await expect(
      definirPrincipal(
        t.app.db,
        natif,
        { kind: 'contact', id: c1 },
        { kind: 'entreprise', id: etrangere },
      ),
    ).rejects.toBeInstanceOf(FicheInvalide);
  });

  it('écrit d’abord dans HubSpot, ou simule sans rien écrire dans l’OS', async () => {
    const opp = await hubspotId('opportunites', '301');
    const romain = await hubspotId('contacts', '202');
    const avant = await nbLiens('affaire_contacts');

    const simulee = await lierFiches(
      t.app.db,
      hub,
      { kind: 'affaire', id: opp },
      { kind: 'contact', id: romain },
      off(),
    );
    expect(simulee).toMatchObject({ simulation: true });
    expect(portal.calls).toHaveLength(0);
    expect(await nbLiens('affaire_contacts')).toBe(avant);

    const armed = { ...hub, config: { ecrituresReelles: true } };
    await lierFiches(
      t.app.db,
      armed,
      { kind: 'affaire', id: opp },
      { kind: 'contact', id: romain },
      on(),
    );
    expect(portal.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'PUT /crm/v4/objects/deals/301/associations/default/contacts/202',
    ]);
    expect(await nbLiens('affaire_contacts')).toBe(avant + 1);

    portal.calls.length = 0;
    await delierFiches(
      t.app.db,
      armed,
      { kind: 'affaire', id: opp },
      { kind: 'contact', id: romain },
      on(),
    );
    expect(portal.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'DELETE /crm/v4/objects/deals/301/associations/contacts/202',
    ]);
    expect(await nbLiens('affaire_contacts')).toBe(avant);
  });

  it('n’écrit rien dans l’OS quand HubSpot refuse', async () => {
    const opp = await hubspotId('opportunites', '301');
    const romain = await hubspotId('contacts', '202');
    const avant = await nbLiens('affaire_contacts');
    const armed = { ...hub, config: { ecrituresReelles: true } };
    portal.failWith(400);
    await expect(
      lierFiches(
        t.app.db,
        armed,
        { kind: 'affaire', id: opp },
        { kind: 'contact', id: romain },
        on(),
      ),
    ).rejects.toBeInstanceOf(CrmIndisponible);
    expect(await nbLiens('affaire_contacts')).toBe(avant);
  });

  it('refuse d’écrire dans un CRM en lecture seule', async () => {
    const a = await affaire(lecture, 'Affaire copiée fictive', 'hubspot', 'h1');
    const c = await contact(lecture, 'Personne copiée', 'hubspot', 'h2');
    await expect(
      lierFiches(t.app.db, lecture, { kind: 'affaire', id: a }, { kind: 'contact', id: c }, on()),
    ).rejects.toBeInstanceOf(CrmIndisponible);
  });

  it('lie en local une fiche OS à une fiche HubSpot, sans appel HubSpot', async () => {
    const opp = await hubspotId('opportunites', '301');
    const local = await contact(hub, 'Personne locale fictive');
    await lierFiches(
      t.app.db,
      hub,
      { kind: 'affaire', id: opp },
      { kind: 'contact', id: local },
      off(),
    );
    expect(portal.calls).toHaveLength(0);
    const liens = await withInstance(t.app.db, hub.id, (tx) => lireLiens(tx, 'affaire', opp));
    expect(liens.contacts.map((l) => l.nom)).toContain('Personne locale fictive');
  });

  it('laisse HubSpot choisir le principal d’un lien HubSpot', async () => {
    const opp = await hubspotId('opportunites', '301');
    const agathe = await hubspotId('contacts', '201');
    const armed = { ...hub, config: { ecrituresReelles: true } };
    portal.calls.length = 0;
    await expect(
      definirPrincipal(
        t.app.db,
        armed,
        { kind: 'affaire', id: opp },
        { kind: 'contact', id: agathe },
      ),
    ).rejects.toThrow(/dans HubSpot/);
    expect(portal.calls).toHaveLength(0);
  });

  it('promeut un lien quand la copie du principal disparaît', async () => {
    const a = await affaire(natif, 'Affaire orpheline fictive');
    const c1 = await contact(natif, 'Personne disparue');
    const c2 = await contact(natif, 'Personne restante');
    for (const c of [c1, c2])
      await lierFiches(
        t.app.db,
        natif,
        { kind: 'affaire', id: a },
        { kind: 'contact', id: c },
        off(),
      );
    await t.owner.pool.query('update opportunites set contact_id = null where id = $1', [a]);
    await t.owner.pool.query('delete from contacts where id = $1', [c1]);

    await withInstance(t.app.db, natif.id, (tx) => reparerPrincipaux(tx));
    expect(await colonne('opportunites', 'contact_id', a)).toBe(c2);
    const liens = await withInstance(t.app.db, natif.id, (tx) => lireLiens(tx, 'affaire', a));
    expect(liens.contacts.map((l) => [l.nom, l.principal])).toEqual([['Personne restante', true]]);
  });
});
