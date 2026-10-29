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
import { archiveInstance, createInstance } from '../instances/service.js';
import { deposerSujet, type DepotSujet } from './depot.js';
import { marquerReporte, sujetsTraites } from './report.js';
import {
  ajouterSujet,
  compterInbox,
  listInbox,
  marquerTraite,
  modifierSujet,
  remettreATraiter,
  SujetRefuse,
  transformerEnTache,
  trierInbox,
  type SujetVue,
} from './service.js';

const TOKEN = 'pat-eu1-fictif-0000';
const JOUR = 864e5;

const vue = (id: string, echeance: string | null, createdAt: string): SujetVue => ({
  id,
  type: 'autre',
  titre: id,
  resume: null,
  origine: 'os',
  lien: null,
  echeance,
  priorite: 3,
  statut: 'a_traiter',
  tacheId: null,
  createdAt,
  traiteAt: null,
  contact: null,
  entreprise: null,
  instance: { slug: 's', nom: 'S', couleur: null },
  proposition: null,
  livreBlanc: null,
  reunion: null,
});

describe('Inbox : service', () => {
  let t: TestApp;
  let simatis: Instance;
  let m1: Instance;
  let m1Arme: Instance;
  let m2: Instance;
  let demo: Instance;
  let old: Instance;
  let secretsDir: string;
  const portal = fakePortal(demoPortal());
  const off = () => ({ secretsDir, realWrites: false });
  const on = () => ({ secretsDir, realWrites: true });

  const deposer = (i: Instance, cle: string, extra: Partial<DepotSujet> = {}) =>
    withInstance(t.app.db, i.id, (tx) =>
      deposerSujet(tx, {
        type: 'mail_a_repondre',
        titre: `Sujet ${cle}`,
        origine: 'messagerie',
        source: 'routine',
        sourceId: cle,
        ...extra,
      }),
    );
  const nbTaches = async () => (await t.owner.pool.query('select 1 from taches')).rowCount;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, { slug: 'simatis', nom: 'SIMATIS', type: 'propre' });
    m1 = await createInstance(t.owner.db, {
      slug: 'm1',
      nom: 'Mandat un',
      type: 'mandat',
      config: { couleur: '#123456' },
    });
    m1Arme = { ...m1, config: { ...m1.config, ecrituresReelles: true } };
    m2 = await createInstance(t.owner.db, {
      slug: 'm2',
      nom: 'Mandat deux',
      type: 'mandat',
      config: { phase: 'closing' },
    });
    demo = await createInstance(t.owner.db, { slug: 'demo', nom: 'Démo', type: 'prospect' });
    old = await createInstance(t.owner.db, { slug: 'old', nom: 'Ancien', type: 'mandat' });
    await deposer(simatis, 'propre-1');
    await deposer(m1, 'm1-1', { type: 'devis' });
    await deposer(m2, 'm2-1', { type: 'diagnostic' });
    await deposer(demo, 'demo-1');
    await deposer(old, 'old-1');
    await archiveInstance(t.owner.db, 'old');

    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-inbox-'));
    await writeFile(path.join(secretsDir, 'm1.env'), `HUBSPOT_TOKEN=${TOKEN}\n`);
    registerConnector(hubspotConnector({ fetch: portal.fetch, sleep: () => Promise.resolve() }));
    await withInstance(t.app.db, m1.id, (tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'deux_sens' },
      }),
    );
    await syncConnexion(t.app.db, m1, 'crm', off());
  });

  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    portal.calls.length = 0;
  });

  it('orders overdue, then upcoming, then undated newest first', () => {
    const now = Date.now();
    const iso = (d: number) => new Date(now + d * JOUR).toISOString();
    const liste = [
      vue('sans-ancien', null, iso(-5)),
      vue('a-venir-loin', iso(9), iso(-1)),
      vue('sans-recent', null, iso(-1)),
      vue('depasse', iso(-2), iso(-3)),
      vue('a-venir', iso(1), iso(-4)),
    ];
    expect(liste.sort(trierInbox).map((s) => s.id)).toEqual([
      'depasse',
      'a-venir',
      'a-venir-loin',
      'sans-recent',
      'sans-ancien',
    ]);
  });

  it('filters by type and shows treated ones under traites only', async () => {
    const { id } = await deposer(m2, 'm2-mail', { type: 'brouillon_non_envoye' });
    await deposer(m2, 'm2-cr', { type: 'compte_rendu' });
    expect((await listInbox(t.app.db, m2, 'mails')).map((s) => s.id)).toEqual([id]);
    expect((await listInbox(t.app.db, m2, 'comptes_rendus')).map((s) => s.titre)).toEqual([
      'Sujet m2-cr',
    ]);
    expect((await listInbox(t.app.db, m2, 'diagnostics')).map((s) => s.titre)).toEqual([
      'Sujet m2-1',
    ]);
    await marquerTraite(t.app.db, m2, id);
    expect(await listInbox(t.app.db, m2, 'mails')).toEqual([]);
    expect((await listInbox(t.app.db, m2, 'traites')).map((s) => s.id)).toEqual([id]);
    expect((await listInbox(t.app.db, m2, 'tout')).some((s) => s.id === id)).toBe(false);
  });

  it('shows only its own subjects in a mandate', async () => {
    const titres = (await listInbox(t.app.db, m1, 'tout')).map((s) => s.titre);
    expect(titres).toEqual(['Sujet m1-1']);
  });

  it('shows own and active mandates subjects in Mon activité, not demos nor archived', async () => {
    const liste = await listInbox(t.app.db, simatis, 'tout');
    const slugs = new Set(liste.map((s) => s.instance.slug));
    expect(slugs).toEqual(new Set(['simatis', 'm1', 'm2']));
    expect(liste.find((s) => s.instance.slug === 'm1')?.instance).toEqual({
      slug: 'm1',
      nom: 'Mandat un',
      couleur: '#123456',
    });
  });

  it('counts subjects to handle over the whole scope', async () => {
    const n = (await listInbox(t.app.db, simatis, 'tout')).length;
    expect(await compterInbox(t.app.db, simatis)).toBe(n);
    expect(await compterInbox(t.app.db, m1)).toBe((await listInbox(t.app.db, m1, 'tout')).length);
  });

  it('marks treated and puts back, without deleting anything', async () => {
    const { id } = await deposer(simatis, 'propre-coche');
    const traite = await marquerTraite(t.app.db, simatis, id);
    expect(traite).toMatchObject({ statut: 'traite' });
    expect(traite?.traiteAt).not.toBeNull();
    await expect(marquerTraite(t.app.db, simatis, id)).rejects.toBeInstanceOf(SujetRefuse);
    expect(await remettreATraiter(t.app.db, simatis, id)).toMatchObject({
      statut: 'a_traiter',
      traiteAt: null,
    });
    expect(await marquerTraite(t.app.db, m1, id)).toBeNull();
  });

  it('reports again a subject put back then treated again', async () => {
    const { id } = await deposer(simatis, 'propre-reporte');
    await marquerTraite(t.app.db, simatis, id);
    await withInstance(t.app.db, simatis.id, (tx) => marquerReporte(tx, [id]));
    await remettreATraiter(t.app.db, simatis, id);
    await marquerTraite(t.app.db, simatis, id);
    const traites = await withInstance(t.app.db, simatis.id, (tx) => sujetsTraites(tx));
    expect(traites.some((s) => s.id === id)).toBe(true);
  });

  it('refuses to check an a_valider subject', async () => {
    const { id } = await deposer(simatis, 'propre-valider', { type: 'a_valider', origine: 'os' });
    await expect(marquerTraite(t.app.db, simatis, id)).rejects.toBeInstanceOf(SujetRefuse);
  });

  it('turns a subject into an OS task without CRM', async () => {
    const { id } = await deposer(m2, 'm2-tache');
    const r = await transformerEnTache(t.app.db, m2, id, { titre: 'Répondre au mail' }, off());
    expect(r).toMatchObject({ statut: 'tache' });
    const tacheId = (r as SujetVue).tacheId;
    const { rows } = await t.owner.pool.query<{ titre: string; source: string }>(
      'select titre, source from taches where id = $1',
      [tacheId],
    );
    expect(rows).toEqual([{ titre: 'Répondre au mail', source: 'natif' }]);
  });

  it('turns a subject into a HubSpot task when the CRM is HubSpot', async () => {
    const { id } = await deposer(m1, 'm1-tache');
    const r = await transformerEnTache(t.app.db, m1Arme, id, { titre: 'Rappeler' }, on());
    expect(r).toMatchObject({ statut: 'tache' });
    expect(portal.calls.find((c) => c.method === 'POST')?.path).toBe('/crm/v3/objects/tasks');
    const { rows } = await t.owner.pool.query<{ source: string }>(
      'select source from taches where id = $1',
      [(r as SujetVue).tacheId],
    );
    expect(rows[0]?.source).toBe('hubspot');
  });

  it('leaves the subject to handle in simulation', async () => {
    const { id } = await deposer(m1, 'm1-simulation');
    const avant = await nbTaches();
    const r = await transformerEnTache(t.app.db, m1, id, { titre: 'Rappeler' }, off());
    expect(r).toMatchObject({ simulation: true });
    expect(await nbTaches()).toBe(avant);
    const sujet = (await listInbox(t.app.db, m1, 'tout')).find((s) => s.id === id);
    expect(sujet?.statut).toBe('a_traiter');
  });

  it('refuses a second transformation of the same subject', async () => {
    const { id } = await deposer(m2, 'm2-double');
    await transformerEnTache(t.app.db, m2, id, { titre: 'Une fois' }, off());
    const avant = await nbTaches();
    await expect(
      transformerEnTache(t.app.db, m2, id, { titre: 'Deux fois' }, off()),
    ).rejects.toBeInstanceOf(SujetRefuse);
    expect(await nbTaches()).toBe(avant);
  });

  it('gives an entry the default priority 3, and sets it when it is added or changed', async () => {
    const { id } = await deposer(simatis, 'prio-defaut');
    const par = await listInbox(t.app.db, simatis, 'tout');
    expect(par.find((s) => s.id === id)?.priorite).toBe(3);

    const ajoute = await ajouterSujet(t.app.db, simatis, { titre: 'Priorité saisie', priorite: 5 });
    expect(ajoute.priorite).toBe(5);

    const modifie = await modifierSujet(t.app.db, simatis, id, { priorite: 1 });
    expect(modifie?.priorite).toBe(1);
  });

  it('sets and clears the due date of an existing entry, and leaves the rest as it was', async () => {
    const { id } = await deposer(simatis, 'echeance-modif', { priorite: 4 });
    const jour = new Date('2026-10-30T12:00:00+01:00');
    const pose = await modifierSujet(t.app.db, simatis, id, { echeance: jour });
    expect(pose?.echeance).toBe(jour.toISOString());
    expect(pose?.priorite).toBe(4);

    const efface = await modifierSujet(t.app.db, simatis, id, { echeance: null });
    expect(efface?.echeance).toBeNull();
    expect(efface?.priorite).toBe(4);
  });

  it('returns null for an entry of another id', async () => {
    const inconnu = '00000000-0000-4000-8000-000000000000';
    expect(await modifierSujet(t.app.db, simatis, inconnu, { priorite: 2 })).toBeNull();
  });

  it('lists the highest priority first, then the due dates', () => {
    const bas = { ...vue('bas', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z'), priorite: 1 };
    const haut = { ...vue('haut', null, '2026-10-02T00:00:00Z'), priorite: 5 };
    expect([bas, haut].sort(trierInbox).map((s) => s.id)).toEqual(['haut', 'bas']);
  });
});
