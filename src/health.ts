import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { readBackupStatus } from './backup-status.js';

export type HealthDeps = {
  pool: pg.Pool;
  version: string;
  backupStatusFile: string;
};

export function registerHealth(
  app: FastifyInstance,
  { pool, version, backupStatusFile }: HealthDeps,
): void {
  app.get('/health', async (_request, reply) => {
    const [databaseOk, backup] = await Promise.all([
      pool.query('select 1').then(
        () => true,
        (err: unknown) => {
          app.log.warn({ err }, 'database health check failed');
          return false;
        },
      ),
      readBackupStatus(backupStatusFile),
    ]);
    return reply.code(databaseOk ? 200 : 503).send({
      status: databaseOk ? 'ok' : 'degraded',
      version,
      database: databaseOk ? 'ok' : 'error',
      ...backup,
    });
  });
}
