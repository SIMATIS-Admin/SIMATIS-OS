import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

// One container per test run; each test file creates its own database (see test/database.ts).
// Throwaway data: in-memory storage and no fsync, otherwise initdb alone takes ~30 s on Docker Desktop.
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    .withTmpFs({ '/var/lib/postgresql': 'rw' })
    .withEnvironment({ POSTGRES_INITDB_ARGS: '--no-sync' })
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off'])
    .start();
  project.provide('databaseUrl', container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}
