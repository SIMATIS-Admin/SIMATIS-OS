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
  logger?: FastifyServerOptions['logger'];
};

export function buildApp({ pool, db, version, logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  registerHealth(app, { pool, version });
  registerApi(app, { db });
  registerWeb(app);
  return app;
}
