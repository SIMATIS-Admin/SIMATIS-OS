import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import { registerApi } from './api/routes.js';
import { registerBaseVivanteRoutes } from './base-vivante/routes.js';
import type { FetchLike } from './connecteurs/google/oauth.js';
import type { Database } from './db.js';
import type { CompteImap } from './secrets.js';
import { registerHealth } from './health.js';
import { registerMcp } from './mcp/server.js';
import { registerCerveauRoutes } from './cerveau/routes.js';
import { registerRunnerApi } from './routines/runner-api.js';
import { registerAtelierRoutes } from './atelier/routes.js';
import { registerVmaRoutes } from './vma/routes.js';
import { registerTransfertRoutes } from './transfert/routes.js';
import { registerWeb } from './web.js';

export type AppDeps = {
  pool: pg.Pool;
  db: Database;
  // Owner connection of the transfer routes (see registerTransfertRoutes); absent = no transfer.
  transfertDb?: Database;
  version: string;
  backupStatusFile?: string;
  lectureRole?: string;
  realWrites?: boolean;
  secretsDir?: string;
  googleFetch?: FetchLike;
  imapServeur?: Pick<CompteImap, 'host' | 'port' | 'secure'>;
  // Test de VMA : site et jeton des invitations ; null ou absent = non configuré.
  vma?: { url: string; token: string } | null;
  logger?: FastifyServerOptions['logger'];
};

export function buildApp({
  pool,
  db,
  transfertDb,
  version,
  backupStatusFile = './backup-status/last.json',
  lectureRole = 'simatis_app_lecture',
  realWrites = false,
  secretsDir = './secrets/instances',
  googleFetch,
  imapServeur,
  vma = null,
  logger = false,
}: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  registerHealth(app, { pool, version, backupStatusFile });
  registerApi(app, { db, secretsDir, realWrites, googleFetch, imapServeur });
  registerBaseVivanteRoutes(app, { db, secretsDir, realWrites, googleFetch });
  if (transfertDb) registerTransfertRoutes(app, { db, transfertDb });
  registerVmaRoutes(app, { db, connexionDeps: { secretsDir, realWrites }, vma });
  registerAtelierRoutes(app, { db });
  registerMcp(app, { db, pool, lectureRole, realWrites, secretsDir });
  registerRunnerApi(app, { db });
  registerCerveauRoutes(app, { db });
  registerWeb(app);
  return app;
}
