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
import { conversionRates, ETAPES_NATIVES } from './pipeline.js';
import { opportunites } from './schema.js';

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

  const req = async (method: 'GET' | 'PATCH', url: string, payload?: unknown) => {
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
});
