import { tournerBrouillons } from './prospection/quotidienne.js';
import { tournerAlertes } from './base-vivante/alerte-signaux.js';
import { creerClientBodacc } from './signaux/bodacc.js';
import { tournerRecherche } from './enrichissement/routine.js';
import { exigerChatgptEngage, fileCodex } from './enrichissement/codex.js';
import { getOptions } from './preferences/service.js';
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
import { registerOriginGuard } from './origin-guard.js';
import { registerPartenairesRoutes } from './partenaires/routes.js';
import { registerCerveauRoutes } from './cerveau/routes.js';
import { registerRunnerApi } from './routines/runner-api.js';
import { registerAtelierRoutes } from './atelier/routes.js';
import { registerPassationRoutes } from './diagnostic/passation-routes.js';
import { registerVmaRoutes } from './vma/routes.js';
import { registerGestionRoutes } from './gestion/routes.js';
import { registerProspectionRoutes } from './prospection/routes.js';
import { registerSalesnavRoutes } from './salesnav/routes.js';
import { registerVisioRoutes } from './visio/routes.js';
import { registerEnregistrementRoutes } from './visio/enregistrement.routes.js';
import { registerTransfertRoutes } from './transfert/routes.js';
import { registerWeb } from './web.js';
import { lireLimitesIA } from './ia/limites.js';
import { noterJauges } from './ia/conso/jauges.js';
import { archiverEtPurger } from './ia/conso/archive.js';
import { registerLimitesIARoutes } from './ia/routes.js';

export type AppDeps = {
  pool: pg.Pool;
  db: Database;
  // Owner connection of the transfer routes (see registerTransfertRoutes); absent = no transfer.
  transfertDb?: Database;
  version: string;
  backupStatusFile?: string;
  lectureRole?: string;
  realWrites?: boolean;
  // Nom de l'hôte dans le titre des visios (« V - Client x Hôte »).
  visioNomHote?: string;
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
  limitesIAFile?: string;
};

export function buildApp({
  pool,
  db,
  transfertDb,
  version,
  backupStatusFile = './backup-status/last.json',
  lectureRole = 'simatis_app_lecture',
  realWrites = false,
  visioNomHote = 'Simatis',
  secretsDir = './secrets/instances',
  googleFetch,
  imapServeur,
  vma = null,
  relais = null,
  partageKdriveUrl = null,
  enrichissement = null,
  clientIA,
  logger = false,
  limitesIAFile = './secrets/ia-limites.json',
}: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  registerOriginGuard(app);
  registerHealth(app, { pool, version, backupStatusFile });
  registerLimitesIARoutes(app, limitesIAFile);
  registerApi(app, { db, secretsDir, realWrites, googleFetch, imapServeur });
  registerBaseVivanteRoutes(app, { db, secretsDir, realWrites, googleFetch });
  if (transfertDb) registerTransfertRoutes(app, { db, transfertDb });
  registerVmaRoutes(app, { db, connexionDeps: { secretsDir, realWrites }, vma });
  registerPassationRoutes(app, { db, vma });
  const codex = fileCodex();
  const engagement = () => getOptions(db, 'marc');
  const codexEngage = exigerChatgptEngage(
    codex.client,
    async () => (await engagement()).chatgptEngage,
  );
  let timerRecherche: ReturnType<typeof setInterval> | undefined;
  let rechercheEnCours = false;
  app.addHook('onListen', () => {
    timerRecherche = setInterval(() => {
      if (rechercheEnCours) return;
      rechercheEnCours = true;
      void tournerRecherche(db, codexEngage, new Date(), () => lireLimitesIA(limitesIAFile))
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
  // Historique des jauges IA : chaque nouveau relevé du collecteur est conservé.
  let timerJauges: ReturnType<typeof setInterval> | undefined;
  app.addHook('onListen', () => {
    timerJauges = setInterval(() => {
      void lireLimitesIA(limitesIAFile)
        .then((limites) => noterJauges(db, limites))
        .catch((err: unknown) => app.log.error(err, 'Historique des jauges IA'));
    }, 60_000);
    return Promise.resolve();
  });
  app.addHook('onClose', () => {
    clearInterval(timerJauges);
    return Promise.resolve();
  });
  // Archive quotidienne de la consommation IA (après 1 h du matin) et purge des vieux relevés.
  let timerArchiveIA: ReturnType<typeof setInterval> | undefined;
  let archiveIAEnCours = false;
  app.addHook('onListen', () => {
    timerArchiveIA = setInterval(() => {
      if (archiveIAEnCours) return;
      archiveIAEnCours = true;
      void archiverEtPurger(db, new Date())
        .catch((err: unknown) => app.log.error(err, 'Archive de la consommation IA'))
        .finally(() => {
          archiveIAEnCours = false;
        });
    }, 10 * 60_000);
    return Promise.resolve();
  });
  app.addHook('onClose', () => {
    clearInterval(timerArchiveIA);
    return Promise.resolve();
  });

  // Veille quotidienne du BODACC : les nouvelles annonces sur les entreprises de la base
  // arrivent dans l'Inbox.
  const bodacc = creerClientBodacc();
  let timerSignaux: ReturnType<typeof setInterval> | undefined;
  let veilleEnCours = false;
  app.addHook('onListen', () => {
    timerSignaux = setInterval(() => {
      if (veilleEnCours) return;
      veilleEnCours = true;
      void tournerAlertes(db, bodacc)
        .catch((err: unknown) => app.log.error(err, 'Veille du BODACC'))
        .finally(() => {
          veilleEnCours = false;
        });
    }, 60_000);
    return Promise.resolve();
  });
  app.addHook('onClose', () => {
    clearInterval(timerSignaux);
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
    codex: codexEngage,
    db,
    enrichissement,
    ...(clientIA ? { client: clientIA } : {}),
  });
  registerGestionRoutes(app, { db });
  registerEnregistrementRoutes(app, { db });
  registerVisioRoutes(app, { db, secretsDir, realWrites, googleFetch, hote: visioNomHote });
  registerProspectionRoutes(app, { db, connexionDeps: { secretsDir, realWrites } });
  registerSalesnavRoutes(app, { db, connexionDeps: { secretsDir, realWrites } });
  registerAtelierRoutes(app, { db });
  registerPartenairesRoutes(app, { db, secretsDir, realWrites, relais });
  registerMcp(app, { db, pool, lectureRole, realWrites, secretsDir });
  registerRunnerApi(app, {
    db,
    codex,
    engagement,
    drive: { secretsDir, realWrites, ...(googleFetch ? { fetch: googleFetch } : {}) },
  });
  registerCerveauRoutes(app, { db, lienKdrive: partageKdriveUrl, realWrites });
  registerWeb(app);
  return app;
}
