import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../test/database.js';
import { buildApp } from './app.js';
import { createDb, type Database } from './db.js';

describe('GET /health', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: Database;
  let app: FastifyInstance;
  let dir: string;

  const NO_BACKUP = {
    lastBackupAt: null,
    lastRestoreTestAt: null,
    backupOk: null,
    backupError: null,
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    ({ pool, db } = createDb(testDb.url));
    dir = await mkdtemp(path.join(tmpdir(), 'simatis-health-'));
    app = buildApp({ pool, db, version: '1.2.3', backupStatusFile: path.join(dir, 'absent.json') });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await testDb.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('reports ok when the database answers', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      version: '1.2.3',
      database: 'ok',
      ...NO_BACKUP,
    });
  });

  it('shows the last backup written by the backup container', async () => {
    const file = path.join(dir, 'last.json');
    await writeFile(
      file,
      JSON.stringify({
        lastBackupAt: '2026-10-08T03:00:00Z',
        lastRestoreTestAt: '2026-10-05T03:10:00Z',
        ok: true,
        lastError: null,
      }),
    );
    const withBackup = buildApp({ pool, db, version: '1.2.3', backupStatusFile: file });
    try {
      const response = await withBackup.inject({ method: 'GET', url: '/health' });
      expect(response.json()).toMatchObject({
        status: 'ok',
        lastBackupAt: '2026-10-08T03:00:00Z',
        lastRestoreTestAt: '2026-10-05T03:10:00Z',
        backupOk: true,
      });
    } finally {
      await withBackup.close();
    }
  });

  it('reports degraded with 503 when the database is unreachable', async () => {
    const { pool: deadPool, db: deadDb } = createDb(
      'postgres://simatis:secret@127.0.0.1:1/simatis',
    );
    const deadApp = buildApp({
      pool: deadPool,
      db: deadDb,
      version: '1.2.3',
      backupStatusFile: path.join(dir, 'absent.json'),
    });
    try {
      const response = await deadApp.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: 'degraded',
        version: '1.2.3',
        database: 'error',
        ...NO_BACKUP,
      });
    } finally {
      await deadApp.close();
      await deadPool.end();
    }
  });
});
