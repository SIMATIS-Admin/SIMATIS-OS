import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { demoPortal, fakePortal } from '../../test/hubspot-portal.js';
import { hubspotConnector } from '../connecteurs/hubspot/index.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { FicheInvalide } from './fiches.js';
import { lierFiches } from './liens.js';
import { CrmIndisponible } from './service.js';
import { REFERENCES, supprimerFiche } from './suppression.js';

const TOKEN = 'pat-eu1-fictif-0000';

describe('Suppression de fiches', () => {
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
  const contact = (i: Instance, nom: string, source = 'natif', sourceId: string | null = null) =>
    insere(i, 'contacts', 'nom, source, source_id', [nom, source, sourceId]);
  const entreprise = (i: Instance, nom: string, source = 'natif', sourceId: string | null = null) =>
    insere(i, 'entreprises', 'nom, source, source_id', [nom, source, sourceId]);
  const affaire = (i: Instance, titre: string, source = 'natif', sourceId: string | null = null) =>
    insere(i, 'opportunites', 'titre, etape, source, source_id', [
      titre,
      'qualification',
      source,
      sourceId,
    ]);
  const existe = async (table: string, id: string) =>
    (
      await t.owner.pool.query<{ n: number }>(
        `select count(*)::int as n from ${table} where id = $1`,
        [id],
      )
    ).rows[0]?.n === 1;
  const colonne = async (table: string, col: string, id: string) =>
    (
      await t.owner.pool.query<{ v: string | null }>(
        `select ${col} as v from ${table} where id = $1`,
        [id],
      )
    ).rows[0]?.v ?? null;

  beforeAll(async () => {
    t = await setupTestApp();
    natif = await createInstance(t.owner.db, { slug: 'sup-os', nom: 'OS', type: 'mandat' });
    autre = await createInstance(t.owner.db, { slug: 'sup-autre', nom: 'Autre', type: 'mandat' });
    hub = await createInstance(t.owner.db, { slug: 'sup-hub', nom: 'Hub', type: 'mandat' });
    lecture = await createInstance(t.owner.db, { slug: 'sup-lecture', nom: 'L', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-sup-'));
    for (const slug of ['sup-hub', 'sup-lecture'])
      await writeFile(path.join(secretsDir, `${slug}.env`), `HUBSPOT_TOKEN=${TOKEN}\n`);
    registerConnector(hubspotConnector({ fetch: portal.fetch, sleep: () => Promise.resolve() }));
    for (const [i, sens] of [
      [hub, 'deux_sens'],
      [lecture, 'lecture'],
    ] as const) {
      await withInstance(t.app.db, i.id, (tx) =>
        configureConnexion(tx, { kind: 'crm', fournisseur: 'hubspot', reglages: { sens } }),
      );
    }
  });

  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    portal.calls.length = 0;
  });

  it('supprime une organisation locale : liens retirés, contacts détachés', async () => {
    const e = await entreprise(natif, 'Organisation fictive');
    const c = await contact(natif, 'Personne fictive');
    await lierFiches(
      t.app.db,
      natif,
      { kind: 'contact', id: c },
      { kind: 'entreprise', id: e },
      off(),
    );
    expect(await colonne('contacts', 'entreprise_id', c)).toBe(e);

    expect(await supprimerFiche(t.app.db, natif, { kind: 'entreprise', id: e }, off())).toEqual({
      ok: true,
    });
    expect(await existe('entreprises', e)).toBe(false);
    expect(await existe('contacts', c)).toBe(true);
    expect(await colonne('contacts', 'entreprise_id', c)).toBeNull();
    const liens = await t.owner.pool.query(
      'select 1 from contact_entreprises where contact_id=$1',
      [c],
    );
    expect(liens.rowCount).toBe(0);
  });

  it('détache les tâches et les activités sans les supprimer', async () => {
    const c = await contact(natif, 'Personne avec historique');
    const tache = await insere(natif, 'taches', 'contact_id, titre, canal', [
      c,
      'À faire',
      'tache',
    ]);
    const activite = await insere(natif, 'activites', 'contact_id, type, at', [
      c,
      'note',
      new Date(),
    ]);
    await supprimerFiche(t.app.db, natif, { kind: 'contact', id: c }, off());
    expect(await existe('taches', tache)).toBe(true);
    expect(await colonne('taches', 'contact_id', tache)).toBeNull();
    expect(await existe('activites', activite)).toBe(true);
    expect(await colonne('activites', 'contact_id', activite)).toBeNull();
  });

  it('le lien suivant devient principal quand on supprime le contact principal', async () => {
    const a = await affaire(natif, 'Affaire fictive');
    const c1 = await contact(natif, 'Principal fictif');
    const c2 = await contact(natif, 'Second fictif');
    for (const c of [c1, c2])
      await lierFiches(
        t.app.db,
        natif,
        { kind: 'affaire', id: a },
        { kind: 'contact', id: c },
        off(),
      );
    expect(await colonne('opportunites', 'contact_id', a)).toBe(c1);
    await supprimerFiche(t.app.db, natif, { kind: 'contact', id: c1 }, off());
    expect(await colonne('opportunites', 'contact_id', a)).toBe(c2);
    const principal = await t.owner.pool.query(
      'select contact_id from affaire_contacts where opportunite_id=$1 and principal',
      [a],
    );
    expect(principal.rows).toEqual([{ contact_id: c2 }]);
  });

  it('archive dans HubSpot puis supprime en local en mode réel', async () => {
    const e = await entreprise(hub, 'Copie HubSpot fictive', 'hubspot', '101');
    expect(
      await supprimerFiche(
        t.app.db,
        { ...hub, config: { ecrituresReelles: true } },
        { kind: 'entreprise', id: e },
        on(),
      ),
    ).toEqual({
      ok: true,
    });
    expect(portal.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'DELETE /crm/v3/objects/companies/101',
    ]);
    expect(await existe('entreprises', e)).toBe(false);
  });

  it('simulation : ni HubSpot ni la base ne changent', async () => {
    const e = await entreprise(hub, 'Copie simulée fictive', 'hubspot', '102');
    const r = await supprimerFiche(t.app.db, hub, { kind: 'entreprise', id: e }, off());
    expect(r).toMatchObject({ simulation: true });
    expect(portal.calls).toEqual([]);
    expect(await existe('entreprises', e)).toBe(true);
  });

  it('refuse une fiche HubSpot quand le CRM est en lecture seule', async () => {
    const c = await contact(lecture, 'Copie en lecture', 'hubspot', '201');
    await expect(
      supprimerFiche(t.app.db, lecture, { kind: 'contact', id: c }, on()),
    ).rejects.toBeInstanceOf(CrmIndisponible);
    expect(await existe('contacts', c)).toBe(true);
  });

  it('refuse de supprimer une affaire qui a un devis', async () => {
    const a = await affaire(natif, 'Affaire avec devis');
    await insere(natif, 'devis', 'opportunite_id, numero', [a, 'D-FICTIF-1']);
    await expect(
      supprimerFiche(t.app.db, natif, { kind: 'affaire', id: a }, off()),
    ).rejects.toBeInstanceOf(FicheInvalide);
    expect(await existe('opportunites', a)).toBe(true);
  });

  it('refuse de supprimer une entreprise qui a un atelier stratégique', async () => {
    const e = await entreprise(natif, 'Entreprise avec atelier');
    await insere(natif, 'ateliers_strategie', 'entreprise_id, titre, etat', [
      e,
      'Atelier fictif',
      JSON.stringify({ v: 1, step: 0 }),
    ]);
    await expect(
      supprimerFiche(t.app.db, natif, { kind: 'entreprise', id: e }, off()),
    ).rejects.toThrow(/atelier/);
    expect(await existe('entreprises', e)).toBe(true);
  });

  it('ignore une fiche d’une autre instance', async () => {
    const e = await entreprise(autre, 'Organisation ailleurs');
    await expect(
      supprimerFiche(t.app.db, natif, { kind: 'entreprise', id: e }, off()),
    ).rejects.toBeInstanceOf(FicheInvalide);
    expect(await existe('entreprises', e)).toBe(true);
  });

  it('REFERENCES couvre toutes les clés étrangères vers les fiches', async () => {
    const { rows } = await t.owner.pool.query<{ ref: string }>(
      `select c.conrelid::regclass::text || '.' || a.attname as ref
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.contype = 'f'
          and c.confrelid::regclass::text in ('contacts', 'entreprises', 'opportunites')
          and c.confdeltype <> 'c'`,
    );
    expect(rows.map((r) => r.ref).sort()).toEqual(
      REFERENCES.map((r) => `${r.table}.${r.colonne}`).sort(),
    );
  });
});
