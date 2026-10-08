import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import { registerApi } from './api/routes.js';
import type { Database } from './db.js';
import { registerHealth } from './health.js';
import { registerWeb } from './web.js';

export type AppDeps = {
  pool: pg.Pool;
  db: Database;
  version: string;
  backupStatusFile?: string;
  logger?: FastifyServerOptions['logger'];
};

export function buildApp({
  pool,
  db,
  version,
  backupStatusFile = './backup-status/last.json',
  logger = false,
}: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  registerHealth(app, { pool, version, backupStatusFile });
  registerApi(app, { db });
  registerWeb(app);
  return app;
}
