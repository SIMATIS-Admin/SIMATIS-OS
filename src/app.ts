import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import { registerApi } from './api/routes.js';
import type { Database } from './db.js';
import { registerHealth } from './health.js';
import { registerMcp } from './mcp/server.js';
import { registerWeb } from './web.js';

export type AppDeps = {
  pool: pg.Pool;
  db: Database;
  version: string;
  backupStatusFile?: string;
  lectureRole?: string;
  realWrites?: boolean;
  logger?: FastifyServerOptions['logger'];
};

export function buildApp({
  pool,
  db,
  version,
  backupStatusFile = './backup-status/last.json',
  lectureRole = 'simatis_app_lecture',
  realWrites = false,
  logger = false,
}: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  registerHealth(app, { pool, version, backupStatusFile });
  registerApi(app, { db });
  registerMcp(app, { db, pool, lectureRole, realWrites });
  registerWeb(app);
  return app;
}
