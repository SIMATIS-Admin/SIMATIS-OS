import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../test/database.js';
import { buildApp } from './app.js';
import { createDb } from './db.js';

describe('GET /health', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    ({ pool } = createDb(testDb.url));
    app = buildApp({ pool, version: '1.2.3' });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await testDb.drop();
  });

  it('reports ok when the database answers', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      version: '1.2.3',
      database: 'ok',
      lastBackupAt: null,
    });
  });

  it('reports degraded with 503 when the database is unreachable', async () => {
    const { pool: deadPool } = createDb('postgres://simatis:secret@127.0.0.1:1/simatis');
    const deadApp = buildApp({ pool: deadPool, version: '1.2.3' });
    try {
      const response = await deadApp.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: 'degraded',
        version: '1.2.3',
        database: 'error',
        lastBackupAt: null,
      });
    } finally {
      await deadApp.close();
      await deadPool.end();
    }
  });
});
