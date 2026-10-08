import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export type HealthDeps = {
  pool: pg.Pool;
  version: string;
};

export function registerHealth(app: FastifyInstance, { pool, version }: HealthDeps): void {
  app.get('/health', async (_request, reply) => {
    const databaseOk = await pool.query('select 1').then(
      () => true,
      (err: unknown) => {
        app.log.warn({ err }, 'database health check failed');
        return false;
      },
    );
    return reply.code(databaseOk ? 200 : 503).send({
      status: databaseOk ? 'ok' : 'degraded',
      version,
      database: databaseOk ? 'ok' : 'error',
      lastBackupAt: null,
    });
  });
}
