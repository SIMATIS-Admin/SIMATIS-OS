import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import fixtures from '../demo/fixtures.json' with { type: 'json' };
import { seedDemoIfEmpty } from '../demo/seed.js';

const simatis = fixtures.find((f) => f.slug === 'simatis');
const ouvertes = simatis?.opportunites.filter((o) => !o.clos) ?? [];
const total = (q: Record<string, number> | null) =>
  q ? Object.values(q).reduce((a, n) => a + n, 0) : 0;

describe('dashboard API', () => {
  let t: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  it('sums the open pipeline and the hot deals of the instance only', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/i/simatis/tableau' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      pipeline: {
        nombre: ouvertes.length,
        montant: ouvertes.reduce((a, o) => a + (o.montant ?? 0), 0),
      },
      chaudes: { nombre: ouvertes.filter((o) => total(o.qualification) >= 12).length },
      derniereCampagne: null,
      simulation: { caAnnuel: 544320 },
    });
  });

  it('keeps one-off and monthly amounts apart in the open pipeline', async () => {
    const base = (await app.inject({ method: 'GET', url: '/api/i/simatis/tableau' })).json<{
      pipeline: { montant: number; mensuel: number; engage: number };
    }>().pipeline;
    expect(base.mensuel).toBe(0);
    const cree = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/opportunites',
      payload: {
        titre: 'Abonnement test',
        etape: 'qualification',
        montant: 1000,
        modeFacturation: 'recurrent',
        dureeEngagementMois: 12,
      },
    });
    expect(cree.statusCode).toBe(200);
    const apres = (await app.inject({ method: 'GET', url: '/api/i/simatis/tableau' })).json<{
      pipeline: { montant: number; mensuel: number; engage: number };
    }>().pipeline;
    expect(apres).toMatchObject({ montant: base.montant, mensuel: 1000, engage: 12000 });
  });

  it('saves a slider within bounds and refuses one outside', async () => {
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/i/simatis/funnel',
      payload: { leads: 999 },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/i/simatis/funnel',
      payload: { leads: 120 },
    });
    expect(ok.json()).toMatchObject({ funnel: { leads: 120, panier: 16000 } });
    const again = await app.inject({ method: 'GET', url: '/api/i/simatis/tableau' });
    expect(again.json()).toMatchObject({ funnel: { leads: 120 } });
  });
});
