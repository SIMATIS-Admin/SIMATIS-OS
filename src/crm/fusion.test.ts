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
import { fusionnerFiches } from './fusion.js';

const TOKEN = 'pat-eu1-fictif-0000';

describe('Fusion de fiches', () => {
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
    natif = await createInstance(t.owner.db, { slug: 'fus-os', nom: 'OS', type: 'mandat' });
    autre = await createInstance(t.owner.db, { slug: 'fus-autre', nom: 'Autre', type: 'mandat' });
    hub = await createInstance(t.owner.db, { slug: 'fus-hub', nom: 'Hub', type: 'mandat' });
    lecture = await createInstance(t.owner.db, { slug: 'fus-lecture', nom: 'L', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-fus-'));
    for (const slug of ['fus-hub', 'fus-lecture'])
      await writeFile(path.join(secretsDir, `${slug}.env`), `HUBSPOT_TOKEN=${TOKEN}\n`);
    // Fake HubSpot answer for a record already merged elsewhere (a redirection, not a live record).
    const dejaFusionnee = (url: string, init?: RequestInit) =>
      url.endsWith('/merge') &&
      typeof init?.body === 'string' &&
      init.body.includes('"objectIdToMerge":"206"')
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                message: 'Cannot merge 206 because it has a forward reference to 207',
              }),
              { status: 400, headers: { 'content-type': 'application/json' } },
            ),
          )
        : portal.fetch(url, init ?? {});
    registerConnector(hubspotConnector({ fetch: dejaFusionnee, sleep: () => Promise.resolve() }));
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

  const fusion = (
    i: Instance,
    kind: 'entreprise' | 'contact' | 'affaire',
    g: string,
    a: string,
    d = off(),
  ) => fusionnerFiches(t.app.db, i, kind, g, a, d);
  const principaux = async (table: string, owner: string, ownerCol: string) =>
    (
      await t.owner.pool.query(`select * from ${table} where ${ownerCol} = $1 and principal`, [
        owner,
      ])
    ).rowCount;

  it('complète les champs vides sans écraser les champs remplis', async () => {
    const g = await insere(natif, 'entreprises', 'nom, ville, secteur', [
      'Organisation gardée',
      'Annecy',
      null,
    ]);
    const a = await insere(natif, 'entreprises', 'nom, ville, secteur, domaine', [
      'Organisation absorbée',
      'Lyon',
      'Industrie',
      'exemple.test',
    ]);
    expect(await fusion(natif, 'entreprise', g, a)).toEqual({ ok: true });
    expect(await colonne('entreprises', 'ville', g)).toBe('Annecy');
    expect(await colonne('entreprises', 'secteur', g)).toBe('Industrie');
    expect(await colonne('entreprises', 'domaine', g)).toBe('exemple.test');
    expect(await colonne('entreprises', 'nom', g)).toBe('Organisation gardée');
    expect(await existe('entreprises', a)).toBe(false);
  });

  it('contacts : la gardée reçoit les adresses de l’absorbée, sans second principal', async () => {
    const g = await insere(natif, 'contacts', 'nom, email', ['Gardé', 'garde@exemple.test']);
    const a = await insere(natif, 'contacts', 'nom, email', ['Absorbé', 'absorbe@exemple.test']);
    await insere(natif, 'contact_emails', 'contact_id, email', [a, 'autre@exemple.test']);
    await fusion(natif, 'contact', g, a);
    const { rows } = await t.owner.pool.query(
      'select email, principal from contact_emails where contact_id = $1 order by email',
      [g],
    );
    expect(rows).toEqual([
      { email: 'absorbe@exemple.test', principal: false },
      { email: 'autre@exemple.test', principal: false },
      { email: 'garde@exemple.test', principal: true },
    ]);
  });

  it('repointe tâches, activités et sujets vers la fiche gardée', async () => {
    const g = await contact(natif, 'Contact gardé');
    const a = await contact(natif, 'Contact absorbé');
    const tache = await insere(natif, 'taches', 'contact_id, titre, canal', [
      a,
      'À faire',
      'tache',
    ]);
    const activite = await insere(natif, 'activites', 'contact_id, type, at', [
      a,
      'note',
      new Date(),
    ]);
    await fusion(natif, 'contact', g, a);
    expect(await colonne('taches', 'contact_id', tache)).toBe(g);
    expect(await colonne('activites', 'contact_id', activite)).toBe(g);
  });

  it('repointe les devis vers l’affaire gardée', async () => {
    const g = await affaire(natif, 'Affaire gardée');
    const a = await affaire(natif, 'Affaire absorbée');
    const devis = await insere(natif, 'devis', 'opportunite_id, numero', [a, 'D-FICTIF-2']);
    await fusion(natif, 'affaire', g, a);
    expect(await colonne('devis', 'opportunite_id', devis)).toBe(g);
  });

  it('deux organisations liées au même contact : un seul lien et un seul principal', async () => {
    const g = await entreprise(natif, 'Organisation A');
    const a = await entreprise(natif, 'Organisation B');
    const c = await contact(natif, 'Contact commun');
    const d = await contact(natif, 'Contact de B');
    for (const e of [g, a])
      await lierFiches(
        t.app.db,
        natif,
        { kind: 'contact', id: c },
        { kind: 'entreprise', id: e },
        off(),
      );
    await lierFiches(
      t.app.db,
      natif,
      { kind: 'contact', id: d },
      { kind: 'entreprise', id: a },
      off(),
    );
    expect(await colonne('contacts', 'entreprise_id', c)).toBe(g);
    expect(await colonne('contacts', 'entreprise_id', d)).toBe(a);
    await fusion(natif, 'entreprise', g, a);
    const liens = await t.owner.pool.query<{ contact_id: string }>(
      'select contact_id from contact_entreprises where entreprise_id = $1 order by 1',
      [g],
    );
    expect(liens.rows.map((r) => r.contact_id).sort()).toEqual([c, d].sort());
    expect(await principaux('contact_entreprises', c, 'contact_id')).toBe(1);
    expect(await principaux('contact_entreprises', d, 'contact_id')).toBe(1);
    expect(await colonne('contacts', 'entreprise_id', c)).toBe(g);
    expect(await colonne('contacts', 'entreprise_id', d)).toBe(g);
  });

  it('les liens de l’absorbée passent sur la gardée quand celle-ci n’en a pas', async () => {
    const g = await contact(natif, 'Contact gardé sans lien');
    const a = await contact(natif, 'Contact absorbé lié');
    const e = await entreprise(natif, 'Organisation du contact');
    await lierFiches(
      t.app.db,
      natif,
      { kind: 'contact', id: a },
      { kind: 'entreprise', id: e },
      off(),
    );
    await fusion(natif, 'contact', g, a);
    expect(await colonne('contacts', 'entreprise_id', g)).toBe(e);
    expect(await principaux('contact_entreprises', g, 'contact_id')).toBe(1);
  });

  it('HubSpot réel : appelle la fusion native avec la fiche gardée en principale', async () => {
    const g = await contact(hub, 'Gardé HubSpot fictif', 'hubspot', '201');
    const a = await contact(hub, 'Absorbé HubSpot fictif', 'hubspot', '202');
    const armed = { ...hub, config: { ecrituresReelles: true } };
    expect(await fusion(armed, 'contact', g, a, on())).toEqual({ ok: true });
    expect(portal.calls.map((c) => [c.method, c.path, c.body])).toEqual([
      [
        'POST',
        '/crm/v3/objects/contacts/merge',
        { primaryObjectId: '201', objectIdToMerge: '202' },
      ],
    ]);
    expect(await existe('contacts', a)).toBe(false);
  });

  it('HubSpot : une absorbée déjà fusionnée côté HubSpot est fusionnée localement', async () => {
    const g = await contact(hub, 'Gardé redirigé fictif', 'hubspot', '207');
    const a = await contact(hub, 'Absorbé redirigé fictif', 'hubspot', '206');
    const armed = { ...hub, config: { ecrituresReelles: true } };
    expect(await fusion(armed, 'contact', g, a, on())).toEqual({ ok: true });
    expect(await existe('contacts', a)).toBe(false);
    expect(await existe('contacts', g)).toBe(true);
  });

  it('simulation : base et HubSpot inchangés', async () => {
    const g = await contact(hub, 'Gardé simulé', 'hubspot', '203');
    const a = await contact(hub, 'Absorbé simulé', 'hubspot', '204');
    expect(await fusion(hub, 'contact', g, a)).toMatchObject({ simulation: true });
    expect(portal.calls).toEqual([]);
    expect(await existe('contacts', a)).toBe(true);
  });

  it('refuse la même fiche, une fiche inconnue ou d’une autre instance', async () => {
    const g = await contact(natif, 'Contact seul');
    const ailleurs = await contact(autre, 'Contact ailleurs');
    await expect(fusion(natif, 'contact', g, g)).rejects.toBeInstanceOf(FicheInvalide);
    await expect(fusion(natif, 'contact', g, ailleurs)).rejects.toBeInstanceOf(FicheInvalide);
    expect(await existe('contacts', ailleurs)).toBe(true);
  });

  it('refuse de garder une fiche locale en absorbant une fiche HubSpot, accepte l’inverse sans appel', async () => {
    const locale = await contact(hub, 'Locale fictive');
    const copie = await contact(hub, 'Copie HubSpot fictive', 'hubspot', '205');
    const armed = { ...hub, config: { ecrituresReelles: true } };
    await expect(fusion(armed, 'contact', locale, copie, on())).rejects.toBeInstanceOf(
      FicheInvalide,
    );
    expect(await fusion(armed, 'contact', copie, locale, on())).toEqual({ ok: true });
    expect(portal.calls).toEqual([]);
    expect(await existe('contacts', locale)).toBe(false);
  });
});
