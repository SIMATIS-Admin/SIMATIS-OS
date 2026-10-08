import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../test/database.js';
import { createDb, type Database } from './db.js';
import { runMigrations } from './migrate.js';

describe('runMigrations', () => {
  let testDb: TestDatabase;
  let db: Database;
  let pool: pg.Pool;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    ({ db, pool } = createDb(testDb.url));
  });

  afterAll(async () => {
    await pool.end();
    await testDb.drop();
  });

  it('runs on a fresh database and can run again', async () => {
    await runMigrations(db);
    await runMigrations(db);

    const { rows } = await pool.query<{ table: string | null }>(
      "select to_regclass('drizzle.__drizzle_migrations')::text as table",
    );
    expect(rows[0]?.table).toBe('drizzle.__drizzle_migrations');
  });
});
