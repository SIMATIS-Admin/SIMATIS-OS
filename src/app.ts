import { tournerBrouillons } from './prospection/quotidienne.js';
import { tournerRecherche } from './enrichissement/routine.js';
import { fileCodex } from './enrichissement/codex.js';
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
  // Lien du dossier de l'espace partagé sur le kDrive ; null ou absent = pas de lien affiché.
  partageKdriveUrl?: string | null;
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
  partageKdriveUrl = null,
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
  const codex = fileCodex();
  let timerRecherche: ReturnType<typeof setInterval> | undefined;
  let rechercheEnCours = false;
  app.addHook('onListen', () => {
    timerRecherche = setInterval(() => {
      if (rechercheEnCours) return;
      rechercheEnCours = true;
      void tournerRecherche(db, codex.client)
        .catch((err: unknown) => app.log.error(err, 'Routine de recherche'))
        .finally(() => {
          rechercheEnCours = false;
        });
    }, 60_000);
    return Promise.resolve();
  });
  app.addHook('onClose', () => {
    clearInterval(timerRecherche);
    return Promise.resolve();
  });
  let timerBrouillons: ReturnType<typeof setInterval> | undefined;
  let preparationEnCours = false;
  app.addHook('onListen', () => {
    timerBrouillons = setInterval(() => {
      if (preparationEnCours) return;
      preparationEnCours = true;
      void tournerBrouillons(db, vma)
        .catch((err: unknown) => app.log.error(err, 'Préparation quotidienne'))
        .finally(() => {
          preparationEnCours = false;
        });
    }, 60_000);
    return Promise.resolve();
  });
  app.addHook('onClose', () => {
    clearInterval(timerBrouillons);
    return Promise.resolve();
  });

  registerEnrichissementRoutes(app, {
    codex: codex.client,
    db,
    enrichissement,
    ...(clientIA ? { client: clientIA } : {}),
  });
  registerGestionRoutes(app, { db });
  registerProspectionRoutes(app, { db, connexionDeps: { secretsDir, realWrites } });
  registerAtelierRoutes(app, { db });
  registerPartenairesRoutes(app, { db, secretsDir, realWrites, relais });
  registerMcp(app, { db, pool, lectureRole, realWrites, secretsDir });
  registerRunnerApi(app, { db, codex });
  registerCerveauRoutes(app, { db, lienKdrive: partageKdriveUrl });
  registerWeb(app);
  return app;
}
