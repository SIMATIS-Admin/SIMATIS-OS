import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';

export type TestDatabase = {
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
    url: url.toString(),
    drop: () => runAdmin(`DROP DATABASE ${name} WITH (FORCE)`),
  };
}
