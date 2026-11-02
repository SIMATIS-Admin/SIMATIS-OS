import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import { registerApi } from './api/routes.js';
import { registerBaseVivanteRoutes } from './base-vivante/routes.js';
import type { Config } from './config.js';
import type { ClientIA } from './enrichissement/client.js';
import { registerEnrichissementRoutes } from './enrichissement/routes.js';
import type { FetchLike } from './connecteurs/google/oauth.js';
import type { Database } from './db.js';
import type { CompteImap } from './secrets.js';
import { registerHealth } from './health.js';
import { registerMcp } from './mcp/server.js';
import { registerPartenairesRoutes } from './partenaires/routes.js';
import { registerCerveauRoutes } from './cerveau/routes.js';
import { registerRunnerApi } from './routines/runner-api.js';
import { registerAtelierRoutes } from './atelier/routes.js';
import { registerVmaRoutes } from './vma/routes.js';
import { registerGestionRoutes } from './gestion/routes.js';
import { registerProspectionRoutes } from './prospection/routes.js';
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
  // Relais d'agents des OS partenaires ; null ou absent = module éteint.
  relais?: { url: string; cleInscription?: string; fetch?: typeof fetch } | null;
  // Enrichissement de listes par IA ; null ou absent = fonction éteinte (pas de clé OpenAI).
  enrichissement?: Config['enrichissement'];
  clientIA?: ClientIA;
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
  relais = null,
  enrichissement = null,
  clientIA,
  logger = false,
}: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  registerHealth(app, { pool, version, backupStatusFile });
  registerApi(app, { db, secretsDir, realWrites, googleFetch, imapServeur });
  registerBaseVivanteRoutes(app, { db, secretsDir, realWrites, googleFetch });
  if (transfertDb) registerTransfertRoutes(app, { db, transfertDb });
  registerVmaRoutes(app, { db, connexionDeps: { secretsDir, realWrites }, vma });
  registerEnrichissementRoutes(app, {
    db,
    enrichissement,
    ...(clientIA ? { client: clientIA } : {}),
  });
  registerGestionRoutes(app, { db });
  registerProspectionRoutes(app, { db, connexionDeps: { secretsDir, realWrites } });
  registerAtelierRoutes(app, { db });
  registerPartenairesRoutes(app, { db, secretsDir, realWrites, relais });
  registerMcp(app, { db, pool, lectureRole, realWrites, secretsDir });
  registerRunnerApi(app, { db });
  registerCerveauRoutes(app, { db });
  registerWeb(app);
  return app;
}
