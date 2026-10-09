import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { getInstanceBySlug, setEcrituresReelles } from '../instances/service.js';
import { canWriteReal } from '../propositions/service.js';
import fixtures from './fixtures.json' with { type: 'json' };

const DEMO = fixtures.find((f) => f.type === 'prospect');

describe('prospect (demo) instances', () => {
  let t: TestApp;
  let app: FastifyInstance;

  const count = async (table: string, slug: string) => {
    const { rows } = await t.owner.pool.query<{ n: number }>(
      `select count(*)::int as n from ${table} where instance_id = (select id from instances where slug = $1)`,
      [slug],
    );
    return rows[0]?.n ?? 0;
  };
  const post = (url: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url, payload: payload as object });

  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  it('creates a prospect with the fictive set and fictive tools only', async () => {
    const res = await post('/api/prospects', { nom: 'Fonderie Écran' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ slug: 'fonderie-ecran', type: 'prospect' });
    expect(await count('opportunites', 'fonderie-ecran')).toBe(DEMO?.opportunites.length);
    const { rows } = await t.owner.pool.query<{ fournisseur: string }>(
      "select fournisseur from connexions where instance_id = (select id from instances where slug = 'fonderie-ecran')",
    );
    expect(rows.map((r) => r.fournisseur)).toEqual(['fake', 'fake', 'fake']);

    const again = await post('/api/prospects', { nom: 'Fonderie Écran' });
    expect(again.json()).toMatchObject({ slug: 'fonderie-ecran-2' });
  });

  it('never lets a prospect write to a real tool', async () => {
    await expect(setEcrituresReelles(t.owner.db, 'fonderie-ecran', true)).rejects.toThrow(
      /prospect/,
    );
    const prospect = await getInstanceBySlug(t.owner.db, 'fonderie-ecran');
    if (!prospect) throw new Error('missing prospect');
    // Even with a tampered config, the lock holds.
    expect(canWriteReal({ ...prospect, config: { ecrituresReelles: true } }, true)).toBe(false);
  });

  it('resets the demo to the fictive set', async () => {
    await t.owner.pool.query(
      "delete from opportunites where instance_id = (select id from instances where slug = 'fonderie-ecran')",
    );
    expect(await count('opportunites', 'fonderie-ecran')).toBe(0);
    const res = await post('/api/i/fonderie-ecran/demo/reinitialiser');
    expect(res.statusCode).toBe(200);
    expect(await count('opportunites', 'fonderie-ecran')).toBe(DEMO?.opportunites.length);
    expect(await count('connexions', 'fonderie-ecran')).toBe(3);
  });

  it('converts into a mandate with no fictive data and three tools to connect, once', async () => {
    const res = await post('/api/i/fonderie-ecran/convertir', { crm: 'hubspot' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ type: 'mandat' });
    expect(await count('entreprises', 'fonderie-ecran')).toBe(0);
    expect(await count('propositions', 'fonderie-ecran')).toBe(0);
    const { rows } = await t.owner.pool.query<{ kind: string; fournisseur: string; etat: string }>(
      "select kind, fournisseur, etat from connexions where instance_id = (select id from instances where slug = 'fonderie-ecran') order by kind",
    );
    expect(rows).toEqual([
      { kind: 'agenda', fournisseur: 'google-agenda', etat: 'non_configuree' },
      { kind: 'crm', fournisseur: 'hubspot', etat: 'non_configuree' },
      { kind: 'messagerie', fournisseur: 'gmail', etat: 'non_configuree' },
    ]);

    expect((await post('/api/i/fonderie-ecran/convertir', { crm: null })).statusCode).toBe(409);
    expect((await post('/api/i/fonderie-ecran/demo/reinitialiser')).statusCode).toBe(409);
    expect(
      (await post('/api/i/fonderie-ecran-2/convertir', { crm: 'salesforce' })).statusCode,
    ).toBe(400);
  });
});
