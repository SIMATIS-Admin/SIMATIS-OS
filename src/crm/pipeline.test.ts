import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { demoPortal, fakePortal } from '../../test/hubspot-portal.js';
import { buildApp } from '../app.js';
import { hubspotConnector } from '../connecteurs/hubspot/index.js';
import { mapStages } from '../connecteurs/hubspot/mapping.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import fixtures from '../demo/fixtures.json' with { type: 'json' };
import { seedDemoIfEmpty } from '../demo/seed.js';
import { createInstance, listInstances } from '../instances/service.js';
import { conversionRates, ETAPES_NATIVES, getPipeline } from './pipeline.js';
import { opportunites, taches } from './schema.js';

const IDS = ETAPES_NATIVES.map((e) => e.id);
type Opp = { etape: string; clos: 'gagne' | 'perdu' | null };

describe('conversionRates', () => {
  it('gives the mockup rates on the fictive SIMATIS deals', () => {
    const simatis = fixtures.find((f) => f.slug === 'simatis');
    expect(conversionRates((simatis?.opportunites ?? []) as Opp[], IDS)).toEqual([
      83, 80, 63, 60, 67,
    ]);
  });

  it('returns no rate at all without deals', () => {
    expect(conversionRates([], IDS)).toEqual([null, null, null, null, null]);
  });

  it('counts a deal lost in qualification up to qualification only', () => {
    const rates = conversionRates([{ etape: 'qualification', clos: 'perdu' }], IDS);
    expect(rates).toEqual([100, 100, 0, null, null]);
  });
});

describe('pipeline API', () => {
  let t: TestApp;
  let secretsDir: string;
  const portal = fakePortal(demoPortal());
  let app: ReturnType<typeof buildApp>;

  const req = async (method: 'GET' | 'PATCH' | 'POST', url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object });
    return { status: r.statusCode, body: r.json<Record<string, unknown>>() };
  };
  const oppId = async (slug: string, sourceId: string | null, titre?: string) => {
    const { rows } = await t.owner.pool.query<{ id: string }>(
      `select o.id from opportunites o join instances i on i.id = o.instance_id
       where i.slug = $1 and ($2::text is null or o.source_id = $2) and ($3::text is null or o.titre = $3)`,
      [slug, sourceId, titre ?? null],
    );
    return rows[0]?.id ?? '';
  };

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-pipeline-'));
    await writeFile(path.join(secretsDir, 'mandat-hs.env'), 'HUBSPOT_TOKEN=pat-fictif\n');
    registerConnector(hubspotConnector({ fetch: portal.fetch, sleep: () => Promise.resolve() }));

    const hs = await createInstance(t.owner.db, {
      slug: 'mandat-hs',
      nom: 'Mandat HS',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    await withInstance(t.owner.db, hs.id, async (tx) => {
      await configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'deux_sens', etapes: mapStages(demoPortal().pipelines) },
      });
      await tx.insert(opportunites).values({
        instanceId: hs.id,
        source: 'hubspot',
        sourceId: '301',
        titre: 'Structuration commerciale',
        etape: 'qualifiedtobuy',
      });
    });
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

  it('serves the native pipeline with its stages and rates', async () => {
    const { body } = await req('GET', '/api/i/simatis/pipeline');
    expect(body).toMatchObject({ source: 'natif', ecrit: true, conversions: [83, 80, 63, 60, 67] });
    expect((body.etapes as unknown[]).length).toBe(5);
    expect((body.opportunites as unknown[]).length).toBe(12);
  });

  it('moves, closes with a reason and reopens a native deal, and journals each step', async () => {
    const id = await oppId('simatis', null, 'Accompagnement prospection');
    expect(
      (await req('PATCH', `/api/i/simatis/opportunites/${id}`, { etape: 'proposition' })).body,
    ).toMatchObject({
      opportunite: { etape: 'proposition', clos: null },
      simulation: false,
    });
    const lost = await req('PATCH', `/api/i/simatis/opportunites/${id}`, {
      clos: 'perdu',
      motif: 'Budget reporté',
    });
    expect(lost.body).toMatchObject({
      opportunite: { etape: 'proposition', clos: 'perdu', motif: 'Budget reporté' },
    });
    const reopened = await req('PATCH', `/api/i/simatis/opportunites/${id}`, { rouvrir: true });
    expect(reopened.body).toMatchObject({
      opportunite: { etape: 'proposition', clos: null, motif: null },
    });

    const { rows } = await t.owner.pool.query<{ action: string }>(
      "select action from journal j join instances i on i.id = j.instance_id where i.slug = 'simatis' order by j.id desc limit 3",
    );
    expect(rows.map((r) => r.action.split(' :')[0])).toEqual([
      'Opportunité rouverte',
      'Opportunité perdue',
      'Étape changée',
    ]);
  });

  it('rejects an unknown stage and a deal of another instance', async () => {
    const id = await oppId('simatis', null, 'Direction commerciale partagée');
    expect(
      (await req('PATCH', `/api/i/simatis/opportunites/${id}`, { etape: 'nulle-part' })).status,
    ).toBe(400);
    expect(
      (await req('PATCH', `/api/i/helioval/opportunites/${id}`, { etape: 'proposition' })).status,
    ).toBe(404);
  });

  it('writes the stage to HubSpot exactly once when moving a mirrored deal', async () => {
    const id = await oppId('mandat-hs', '301');
    portal.calls.length = 0;
    const moved = await req('PATCH', `/api/i/mandat-hs/opportunites/${id}`, {
      etape: 'presentationscheduled',
    });
    expect(moved.body).toMatchObject({
      opportunite: { etape: 'presentationscheduled' },
      simulation: false,
    });
    expect(portal.calls).toEqual([
      {
        method: 'PATCH',
        path: '/crm/v3/objects/deals/301',
        body: { properties: { dealstage: 'presentationscheduled' } },
      },
    ]);

    portal.calls.length = 0;
    const won = await req('PATCH', `/api/i/mandat-hs/opportunites/${id}`, { clos: 'gagne' });
    expect(won.body).toMatchObject({ opportunite: { etape: 'closedwon', clos: 'gagne' } });
    expect(portal.calls[0]?.body).toEqual({ properties: { dealstage: 'closedwon' } });
  });

  it('serves the HubSpot open stages as columns and refuses moves when read-only', async () => {
    const { body } = await req('GET', '/api/i/mandat-hs/pipeline');
    expect(body).toMatchObject({ source: 'hubspot', ecrit: true });
    expect((body.etapes as { id: string }[]).map((e) => e.id)).toEqual([
      'appointmentscheduled',
      'qualifiedtobuy',
      'presentationscheduled',
    ]);

    const hs = (await listInstances(t.owner.db)).find((i) => i.slug === 'mandat-hs');
    await withInstance(t.owner.db, hs?.id ?? '', (tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'lecture', etapes: mapStages(demoPortal().pipelines) },
      }),
    );
    const id = await oppId('mandat-hs', '301');
    expect(
      (await req('PATCH', `/api/i/mandat-hs/opportunites/${id}`, { rouvrir: true })).status,
    ).toBe(409);
  });

  it('shows each open deal next activity, overdue state and inactivity against the setting', async () => {
    const act = await createInstance(t.owner.db, { slug: 'activite', nom: 'A', type: 'mandat' });
    const ids = await withInstance(t.owner.db, act.id, async (tx) => {
      const [planifiee, retard, rien, close] = await tx
        .insert(opportunites)
        .values([
          {
            instanceId: act.id,
            titre: 'Planifiée',
            etape: 'qualification',
            derniereActivite: new Date('2026-10-12T09:00:00Z'),
          },
          {
            instanceId: act.id,
            titre: 'En retard',
            etape: 'qualification',
            derniereActivite: new Date('2026-09-24T09:00:00Z'),
          },
          {
            instanceId: act.id,
            titre: 'Rien',
            etape: 'qualification',
            derniereActivite: new Date('2026-10-13T09:00:00Z'),
          },
          { instanceId: act.id, titre: 'Close', etape: 'qualification', clos: 'perdu' as const },
        ])
        .returning({ id: opportunites.id });
      await tx.insert(taches).values([
        {
          instanceId: act.id,
          titre: 'Relancer',
          canal: 'appel',
          opportuniteId: planifiee?.id,
          echeance: new Date('2026-10-16T08:00:00Z'),
        },
        {
          instanceId: act.id,
          titre: 'Relancer',
          canal: 'appel',
          opportuniteId: retard?.id,
          echeance: new Date('2026-10-10T08:00:00Z'),
        },
        {
          instanceId: act.id,
          titre: 'Faite',
          canal: 'appel',
          opportuniteId: rien?.id,
          echeance: new Date('2026-10-10T08:00:00Z'),
          faitAt: new Date('2026-10-10T09:00:00Z'),
        },
      ]);
      return { planifiee: planifiee?.id, retard: retard?.id, rien: rien?.id, close: close?.id };
    });
    const vue = await getPipeline(t.app.db, act, new Date('2026-10-14T10:00:00Z'));
    const opp = (id: string | undefined) => vue.opportunites.find((o) => o.id === id);
    expect(vue.inactiviteJours).toBe(14);
    expect(opp(ids.planifiee)).toMatchObject({
      prochaine: { echeance: '2026-10-16T08:00:00.000Z', enRetard: false },
      joursInactif: 2,
    });
    expect(opp(ids.retard)).toMatchObject({ prochaine: { enRetard: true }, joursInactif: 20 });
    expect(opp(ids.rien)).toMatchObject({ prochaine: null, joursInactif: 1 });
    expect(opp(ids.close)).toMatchObject({ prochaine: null, joursInactif: null });
  });

  it('saves the inactivity threshold without touching the real-writes lock', async () => {
    expect(
      (await req('PATCH', '/api/i/mandat-hs/pipeline/reglages', { inactiviteJours: 0 })).status,
    ).toBe(400);
    const ok = await req('PATCH', '/api/i/mandat-hs/pipeline/reglages', { inactiviteJours: 21 });
    expect(ok.body).toEqual({ inactiviteJours: 21 });
    expect((await req('GET', '/api/i/mandat-hs/pipeline')).body).toMatchObject({
      inactiviteJours: 21,
    });
    const { rows } = await t.owner.pool.query<{ config: Record<string, unknown> }>(
      "select config from instances where slug = 'mandat-hs'",
    );
    expect(rows[0]?.config).toEqual({ ecrituresReelles: true, inactiviteJours: 21 });
  });

  it('creates a native deal in an open stage, and refuses an unknown stage', async () => {
    const avant = ((await req('GET', '/api/i/simatis/pipeline')).body.opportunites as unknown[])
      .length;
    const cree = await req('POST', '/api/i/simatis/opportunites', {
      titre: 'Audit flotte',
      montant: 7000,
      etape: 'qualification',
      echeance: '2026-12-01',
    });
    expect(cree.status).toBe(200);
    expect(cree.body).toMatchObject({
      titre: 'Audit flotte',
      etape: 'qualification',
      source: 'natif',
    });
    const apres = (await req('GET', '/api/i/simatis/pipeline')).body.opportunites as unknown[];
    expect(apres.length).toBe(avant + 1);
    const refus = await req('POST', '/api/i/simatis/opportunites', {
      titre: 'X',
      etape: 'inconnue',
    });
    expect(refus.status).toBe(400);
  });

  it('creates a spot deal by default and a recurring one with its commitment, and patches it', async () => {
    const spot = await req('POST', '/api/i/simatis/opportunites', {
      titre: 'Mission ponctuelle',
      montant: 5000,
      etape: 'prospection',
    });
    expect(spot.body).toMatchObject({
      modeFacturation: 'spot',
      dureeEngagementMois: 12,
      taciteReconduction: true,
    });
    const abo = await req('POST', '/api/i/simatis/opportunites', {
      titre: 'Accompagnement mensuel',
      montant: 1200,
      etape: 'prospection',
      modeFacturation: 'recurrent',
      dureeEngagementMois: 6,
      taciteReconduction: false,
    });
    expect(abo.status).toBe(200);
    expect(abo.body).toMatchObject({
      modeFacturation: 'recurrent',
      dureeEngagementMois: 6,
      taciteReconduction: false,
    });
    const id = (abo.body as { id: string }).id;
    const bascule = await req('PATCH', `/api/i/simatis/fiches/affaire/${id}`, {
      modeFacturation: 'spot',
    });
    expect(bascule.body).toMatchObject({ fiche: { modeFacturation: 'spot' } });
    const pipe = (await req('GET', '/api/i/simatis/pipeline')).body.opportunites as {
      id: string;
      modeFacturation: string;
    }[];
    expect(pipe.find((o) => o.id === id)?.modeFacturation).toBe('spot');
    for (const mauvais of [
      { modeFacturation: 'trimestriel' },
      { dureeEngagementMois: 0 },
      { dureeEngagementMois: 121 },
    ])
      expect(
        (
          await req('POST', '/api/i/simatis/opportunites', {
            titre: 'X',
            etape: 'prospection',
            ...mauvais,
          })
        ).status,
      ).toBe(400);
  });

  it('sets a deal probability by hand, resets it, and refuses out-of-range values', async () => {
    const cree = await req('POST', '/api/i/simatis/opportunites', {
      titre: 'Probabilité manuelle',
      etape: 'prospection',
    });
    const id = (cree.body as { id: string }).id;
    expect(cree.body).toMatchObject({ probabilite: null });
    const url = `/api/i/simatis/fiches/affaire/${id}`;
    expect((await req('PATCH', url, { probabilite: 65 })).body).toMatchObject({
      fiche: { probabilite: 65 },
    });
    const pipe = (await req('GET', '/api/i/simatis/pipeline')).body.opportunites as {
      id: string;
      probabilite: number | null;
    }[];
    expect(pipe.find((o) => o.id === id)?.probabilite).toBe(65);
    expect((await req('PATCH', url, { probabilite: null })).body).toMatchObject({
      fiche: { probabilite: null },
    });
    for (const mauvais of [-1, 101, 12.5])
      expect((await req('PATCH', url, { probabilite: mauvais })).status).toBe(400);
  });

  it('creates a HubSpot deal in HubSpot first, then its copy, and exposes stage probabilities', async () => {
    // An earlier test leaves the mirror read-only.
    await t.owner.pool.query(
      `update connexions set reglages = jsonb_set(reglages, '{sens}', '"deux_sens"')
       where kind = 'crm' and instance_id = (select id from instances where slug = 'mandat-hs')`,
    );
    portal.calls.length = 0;
    const cree = await req('POST', '/api/i/mandat-hs/opportunites', {
      titre: 'Accompagnement 2027',
      etape: 'qualifiedtobuy',
    });
    expect(cree.status).toBe(200);
    expect(portal.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /crm/v3/objects/deals',
    ]);
    expect(cree.body).toMatchObject({ source: 'hubspot', etape: 'qualifiedtobuy' });
    const { body } = await req('GET', '/api/i/mandat-hs/pipeline');
    expect((body.etapes as { probabilite?: unknown }[])[0]).toHaveProperty('probabilite');
  });
});
