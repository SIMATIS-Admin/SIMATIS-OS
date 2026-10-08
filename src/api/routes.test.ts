import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createDb, type Database } from '../db.js';
import fixtures from '../demo/fixtures.json' with { type: 'json' };
import { seedDemoIfEmpty } from '../demo/seed.js';
import { runMigrations } from '../migrate.js';

type Row = Record<string, unknown>;

describe('API instances, entreprises, contacts', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: Database;
  let app: FastifyInstance;

  const get = async (url: string) => {
    const response = await app.inject({ method: 'GET', url });
    return { status: response.statusCode, body: response.json<Row[] & Row>() };
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    ({ pool, db } = createDb(testDb.url));
    await runMigrations(db);
    app = buildApp({ pool, db, version: 'test' });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await testDb.drop();
  });

  it('seeds the fictive instances once, and only into an empty database', async () => {
    expect(await seedDemoIfEmpty(db)).toBe(true);
    expect(await seedDemoIfEmpty(db)).toBe(false);
    const { rows } = await pool.query<{ n: number }>('select count(*)::int as n from entreprises');
    expect(rows[0]?.n).toBe(fixtures.reduce((n, f) => n + f.entreprises.length, 0));
  });

  it('lists instances grouped propre, mandat, prospect', async () => {
    const { status, body } = await get('/api/instances');
    expect(status).toBe(200);
    expect(body.map((i) => i.type)).toEqual(['propre', 'mandat', 'mandat', 'prospect']);
    expect(body[0]).toMatchObject({ slug: 'simatis', nom: 'SIMATIS' });
  });

  it('lists and searches companies of one instance', async () => {
    const all = await get('/api/i/simatis/entreprises');
    expect(all.body).toHaveLength(12);

    const { body } = await get('/api/i/simatis/entreprises?q=plast');
    expect(body.map((e) => e.nom)).toEqual(['Plasturgie Mornand']);
    expect(body[0]).toMatchObject({ nbContacts: 1 });
  });

  it('never returns another instance’s data, even when the search matches it', async () => {
    const helioval = await get('/api/i/helioval/entreprises');
    const helioName = String(helioval.body[0]?.nom);

    const { body } = await get(`/api/i/simatis/entreprises?q=${encodeURIComponent(helioName)}`);
    expect(body).toEqual([]);
  });

  it('searches contacts by email and returns their company', async () => {
    const { body } = await get('/api/i/simatis/contacts?q=k.haddad');
    expect(body).toEqual([
      expect.objectContaining({ nom: 'Karim Haddad', entreprise: 'Plasturgie Mornand' }),
    ]);
  });

  it('returns 404 for an unknown instance', async () => {
    const { status, body } = await get('/api/i/inconnue/contacts');
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Instance inconnue' });
  });
});
