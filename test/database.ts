import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createDb, type Database } from '../src/db.js';
import { appDatabaseUrl, ensureAppRole } from '../src/db/roles.js';
import { runMigrations } from '../src/migrate.js';

export type TestDatabase = {
  name: string;
  url: string;
  drop: () => Promise<void>;
};

async function runAdmin(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: inject('databaseUrl') });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `test_${randomBytes(6).toString('hex')}`;
  await runAdmin(`CREATE DATABASE ${name}`);
  const url = new URL(inject('databaseUrl'));
  url.pathname = `/${name}`;
  return {
    name,
    url: url.toString(),
    drop: () => runAdmin(`DROP DATABASE ${name} WITH (FORCE)`),
  };
}

// Roles are global to the Postgres server; test files run in parallel, so each gets its own.
export const testRoleName = (testDb: TestDatabase) => `app_${testDb.name}`;

export const dropRole = (role: string) => runAdmin(`DROP ROLE IF EXISTS ${role}`);

export type TestApp = {
  owner: { db: Database; pool: pg.Pool };
  app: { db: Database; pool: pg.Pool };
  appUrl: string;
  drop: () => Promise<void>;
};

// Fresh database, migrated, with an app role subject to Row-Level Security.
export async function setupTestApp(): Promise<TestApp> {
  const testDb = await createTestDatabase();
  const owner = createDb(testDb.url);
  await runMigrations(owner.db);
  const role = testRoleName(testDb);
  const password = randomBytes(12).toString('hex');
  await ensureAppRole(owner.pool, { role, password });
  const appUrl = appDatabaseUrl(testDb.url, role, password);
  const app = createDb(appUrl);
  return {
    owner,
    app,
    appUrl,
    drop: async () => {
      await app.pool.end();
      await owner.pool.end();
      await testDb.drop();
      await dropRole(role);
    },
  };
}
