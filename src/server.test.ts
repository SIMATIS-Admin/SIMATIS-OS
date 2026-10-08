import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, dropRole, testRoleName, type TestDatabase } from '../test/database.js';

async function freePort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

function startServer(env: NodeJS.ProcessEnv): { child: ChildProcess; output: () => string } {
  const parentEnv = { ...process.env };
  delete parentEnv.DATABASE_URL;
  delete parentEnv.APP_DB_PASSWORD;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { ...parentEnv, LOG_LEVEL: 'warn', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return { child, output: () => output };
}

async function waitForHealth(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await fetch(url);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

describe('server entry point', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.drop();
    await dropRole(testRoleName(testDb));
  });

  it('migrates, serves the API as the restricted role, and stops cleanly on SIGTERM', async () => {
    const port = await freePort();
    const { child, output } = startServer({
      DATABASE_URL: testDb.url,
      APP_DB_ROLE: testRoleName(testDb),
      APP_DB_PASSWORD: 'server-test-password',
      HOST: '127.0.0.1',
      PORT: String(port),
    });
    try {
      const response = await waitForHealth(`http://127.0.0.1:${port}/health`, 30_000);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'ok', database: 'ok' });

      const entreprises = await fetch(`http://127.0.0.1:${port}/api/i/simatis/entreprises`);
      expect(((await entreprises.json()) as unknown[]).length).toBe(12);
    } finally {
      child.kill('SIGTERM');
    }
    const [code] = (await once(child, 'exit')) as [number | null];
    expect(code, output()).toBe(0);
  }, 60_000);

  it('exits with code 1 and names the variable when the configuration is invalid', async () => {
    const { child, output } = startServer({});
    const [code] = (await once(child, 'exit')) as [number | null];
    expect(code).toBe(1);
    expect(output()).toMatch(/DATABASE_URL/);
  }, 30_000);
});
