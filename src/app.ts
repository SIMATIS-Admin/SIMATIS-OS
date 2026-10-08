import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import { registerHealth } from './health.js';

export type AppDeps = {
  pool: pg.Pool;
  version: string;
  logger?: FastifyServerOptions['logger'];
};

export function buildApp({ pool, version, logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  registerHealth(app, { pool, version });
  return app;
}
