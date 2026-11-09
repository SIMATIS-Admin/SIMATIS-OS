import {
  attendreRecherche,
  lancerRecherche,
  lireRecherche,
  effacerRecherche,
} from './recherche-tache.js';
import {
  cloreSessionRecherche,
  commenterSession,
  contactsDeSession,
  dernieresSessions,
  noterIntegrationSession,
  ouvrirSessionRecherche,
  supprimerSession,
} from './sessions.js';
import { enregistrerRoutineRecherche, lireRoutineRecherche, reglagesRecherche } from './routine.js';
import { DemandeRefusee, interpreter } from '../annuaire/interpreter.js';
import { chercherProspects } from './recherche.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug } from '../instances/service.js';
import { creerClientOpenAI, ErreurIA, type ClientIA } from './client.js';
import { etatLot, lancerLot, LotRefuse, type ReglagesLot } from './lot.js';
import { enrichissementTaches, TYPES_ENRICHISSEMENT } from './schema.js';
import { suggestionsDeLaTache, valider } from './validation.js';
import { and, desc, eq } from 'drizzle-orm';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PARALLELISME = 3;

const lancementSchema = z.object({
  type: z.enum(TYPES_ENRICHISSEMENT),
  profil: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  maxParEntreprise: z.number().int().min(1).max(5),
  ficheIds: z.array(z.string().regex(UUID)).max(100),
});
const validationSchema = z.object({
  accepter: z.array(z.string().regex(UUID)).max(500),
  refuser: z.array(z.string().regex(UUID)).max(500),
});

export type EnrichissementRoutesDeps = {
  db: Database;
  enrichissement: Config['enrichissement'];
  // Remplaçable par un faux dans les tests ; sinon construit depuis la clé configurée.
  client?: ClientIA;
  codex?: ClientIA;
  // Combien de temps attendre l'IA pour traduire une demande de recherche d'entreprises.
  delaiInterpretationMs?: number;
};

export const reglagesDe = (cfg: NonNullable<Config['enrichissement']>): ReglagesLot => ({
  lotMax: cfg.lotMax,
  budgetJetons: cfg.budgetJetons,
  parallelisme: PARALLELISME,
});

export function registerEnrichissementRoutes(
  app: FastifyInstance,
  { db, enrichissement, client, codex, delaiInterpretationMs = 120_000 }: EnrichissementRoutesDeps,
) {
  const ia = client ?? codex ?? (enrichissement ? creerClientOpenAI(enrichissement) : null);

  const reglages =
    codex && !client
      ? { lotMax: 10, budgetJetons: Infinity, parallelisme: 1 }
      : enrichissement
        ? reglagesDe(enrichissement)
        : null;

  type Route = { Params: { slug: string; tacheId?: string; nature?: string }; Body: unknown };
  const surInstance =
    (
      f: (
        instanceId: string,
        request: FastifyRequest<Route>,
        reply: FastifyReply,
      ) => Promise<unknown>,
    ) =>
    async (request: FastifyRequest<Route>, reply: FastifyReply) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      const id = request.params.tacheId;
      if (id !== undefined && !UUID.test(id))
        return reply.code(400).send({ error: 'Identifiant invalide' });
      try {
        return await f(instance.id, request, reply);
      } catch (error) {
        if (error instanceof LotRefuse) return reply.code(400).send({ error: error.message });
        throw error;
      }
    };

  const racine = '/api/i/:slug/base/enrichissement';

  // Journalise une recherche manuelle : ouverte au lancement, close quand le travail de fond se termine.
  const journaliser = async (instanceId: string, tache: { id: string; nombre: number }) => {
    await ouvrirSessionRecherche(db, instanceId, {
      id: tache.id,
      mode: 'manuel',
      nombreVise: tache.nombre,
    });
    void attendreRecherche(tache.id)
      .then(async () => {
        const fin = await lireRecherche(db, instanceId);
        if (fin?.id !== tache.id) return;
        await cloreSessionRecherche(db, instanceId, tache.id, {
          etat:
            fin.etat === 'terminee' ? 'terminee' : fin.etat === 'erreur' ? 'erreur' : 'incomplete',
          trouves: fin.contacts?.length ?? 0,
          contacts: (fin.contacts ?? []).map((c) => ({
            entreprise: c.entreprise,
            prenom: c.prenom,
            nom: c.nom,
            fonction: c.fonction,
          })),
          erreur: fin.erreur,
        });
      })
      .catch(() => undefined);
  };

  app.get<Route>(
    '/api/i/:slug/base/enrichissement-sessions',
    surInstance((instanceId) => dernieresSessions(db, instanceId)),
  );

  const natureSession = (request: FastifyRequest<Route>) => {
    const nature = request.params.nature;
    if (nature !== 'recherche' && nature !== 'enrichissement')
      throw new LotRefuse('Session inconnue.');
    return nature;
  };
  const sessionRoute = '/api/i/:slug/base/enrichissement-sessions/:nature/:tacheId';
  app.get<Route>(
    `${sessionRoute}/contacts`,
    surInstance((instanceId, request) =>
      contactsDeSession(db, instanceId, natureSession(request), request.params.tacheId as string),
    ),
  );
  app.patch<Route>(
    sessionRoute,
    surInstance(async (instanceId, request) => {
      const corps = z.object({ commentaire: z.string().max(2000) }).safeParse(request.body);
      if (!corps.success) throw new LotRefuse('Commentaire invalide.');
      await commenterSession(
        db,
        instanceId,
        natureSession(request),
        request.params.tacheId as string,
        corps.data.commentaire,
      );
      return { ok: true };
    }),
  );
  app.delete<Route>(
    sessionRoute,
    surInstance(async (instanceId, request, reply) => {
      const resultat = await supprimerSession(
        db,
        instanceId,
        natureSession(request),
        request.params.tacheId as string,
      );
      if (resultat === 'absente') return reply.code(404).send({ error: 'Session introuvable.' });
      if (resultat === 'en_cours')
        return reply.code(409).send({ error: 'Cette session est encore en cours.' });
      return { ok: true };
    }),
  );

  app.get<Route>(
    '/api/i/:slug/base/recherche/routine',
    surInstance((instanceId) => lireRoutineRecherche(db, instanceId)),
  );
  app.put<Route>(
    '/api/i/:slug/base/recherche/routine',
    surInstance((instanceId, request) => {
      const resultat = reglagesRecherche.safeParse(request.body);
      if (!resultat.success) throw new LotRefuse('Réglages de recherche invalides.');
      return enregistrerRoutineRecherche(db, instanceId, resultat.data);
    }),
  );

  app.get<Route>(
    '/api/i/:slug/base/recherche/tache',
    surInstance((instanceId) => lireRecherche(db, instanceId)),
  );
  app.delete<Route>(
    '/api/i/:slug/base/recherche/tache',
    surInstance(async (instanceId, request) => {
      const input = z
        .object({
          id: z.string().uuid(),
          // Bilan de l'intégration, quand la recherche est effacée après avoir été intégrée.
          ajoutees: z.number().int().min(0).optional(),
          rapprochees: z.number().int().min(0).optional(),
        })
        .safeParse(request.body);
      if (!input.success) throw new LotRefuse('Recherche invalide.');
      if (input.data.ajoutees !== undefined)
        await noterIntegrationSession(db, instanceId, input.data.id, {
          ajoutees: input.data.ajoutees,
          rapprochees: input.data.rapprochees ?? 0,
        });
      await effacerRecherche(db, instanceId, input.data.id);
      return { ok: true };
    }),
  );
  app.post<Route>(
    '/api/i/:slug/base/recherche/tache/continuer',
    surInstance(async (instanceId, request, reply) => {
      if (!codex) return reply.code(409).send({ error: 'Codex est indisponible.' });
      const precedente = await lireRecherche(db, instanceId);
      if (!precedente || precedente.etat === 'en_cours' || precedente.etat === 'terminee')
        throw new LotRefuse('Aucune recherche à compléter.');
      const input = z
        .object({ consignes: z.string().trim().min(1).max(5000).optional() })
        .safeParse(request.body ?? {});
      const consignes = input.success ? (input.data.consignes ?? precedente.consignes) : undefined;
      if (!consignes) throw new LotRefuse('Précisez les critères pour compléter la recherche.');
      const tache = await lancerRecherche(
        db,
        codex,
        instanceId,
        consignes,
        precedente.nombre,
        precedente.contacts ?? [],
      );
      await journaliser(instanceId, tache);
      return reply.code(202).send(tache);
    }),
  );
  app.post<Route>(
    '/api/i/:slug/base/recherche/tache',
    surInstance(async (instanceId, request, reply) => {
      if (!codex) return reply.code(409).send({ error: 'Codex est indisponible.' });
      const input = z
        .object({
          consignes: z.string().trim().min(1).max(5000),
          nombre: z.number().int().min(1).max(100),
        })
        .safeParse(request.body);
      if (!input.success)
        throw new LotRefuse('Indiquez des consignes et un nombre de contacts entre 1 et 100.');
      const tache = await lancerRecherche(
        db,
        codex,
        instanceId,
        input.data.consignes,
        input.data.nombre,
      );
      await journaliser(instanceId, tache);
      return reply.code(202).send(tache);
    }),
  );

  app.post<Route>(
    '/api/i/:slug/base/recherche',
    surInstance(async (_instanceId, request, reply) => {
      if (!codex) return reply.code(409).send({ error: 'Codex est indisponible.' });
      const input = z
        .object({
          consignes: z.string().trim().min(1).max(5000),
          nombre: z.number().int().min(1).max(100),
        })
        .safeParse(request.body);
      if (!input.success)
        throw new LotRefuse('Indiquez des consignes et un nombre de contacts entre 1 et 100.');
      try {
        return await chercherProspects(codex, input.data.consignes, input.data.nombre);
      } catch (error) {
        throw new LotRefuse(
          error instanceof ErreurIA ? error.message : 'Réponse de recherche Codex invalide.',
        );
      }
    }),
  );

  // « PME de la métallurgie dans le Rhône » → critères pour l'annuaire des entreprises. L'IA ne
  // fait que traduire : la recherche, elle, se fait dans l'annuaire.
  app.post<Route>(
    '/api/i/:slug/base/entreprises/interpreter',
    surInstance(async (_instanceId, request, reply) => {
      if (!ia)
        return reply
          .code(409)
          .send({ error: 'Aucune IA n’est disponible : renseignez les critères à la main.' });
      const input = z
        .object({ demande: z.string().trim().min(1).max(2000) })
        .safeParse(request.body);
      if (!input.success) throw new LotRefuse('Décrivez les entreprises que vous cherchez.');
      // Codex tourne sur le Mac de Marc : s'il est éteint, la demande resterait en attente
      // plusieurs minutes. Mieux vaut rendre la main pour saisir les critères à la main.
      let minuteur: NodeJS.Timeout | undefined;
      const patience = new Promise<never>((_, rejeter) => {
        minuteur = setTimeout(
          () =>
            rejeter(
              new LotRefuse('L’IA ne répond pas : renseignez les critères à la main ou réessayez.'),
            ),
          delaiInterpretationMs,
        );
      });
      try {
        return await Promise.race([interpreter(ia, input.data.demande), patience]);
      } catch (error) {
        if (error instanceof DemandeRefusee || error instanceof ErreurIA)
          throw new LotRefuse(error.message);
        throw error;
      } finally {
        clearTimeout(minuteur);
      }
    }),
  );

  app.get<Route>(
    racine,
    surInstance(async (instanceId) => {
      const [actif] = await withInstance(db, instanceId, (tx) =>
        tx
          .select({ id: enrichissementTaches.id })
          .from(enrichissementTaches)
          .where(
            and(
              eq(enrichissementTaches.instanceId, instanceId),
              eq(enrichissementTaches.etat, 'en_cours'),
            ),
          )
          .orderBy(desc(enrichissementTaches.createdAt)),
      );
      return {
        disponible: reglages !== null,
        lotMax: reglages?.lotMax ?? 0,
        tacheEnCours: actif?.id ?? null,
      };
    }),
  );

  app.post<Route>(
    racine,
    surInstance(async (instanceId, request, reply) => {
      if (!reglages || !ia)
        return reply.code(409).send({ error: 'Clé OpenAI absente : enrichissement indisponible' });
      const corps = lancementSchema.safeParse(request.body);
      if (!corps.success) throw new LotRefuse('Paramètres d’enrichissement invalides');
      const tache = await lancerLot(db, ia, reglages, instanceId, corps.data);
      return reply.code(202).send(tache);
    }),
  );

  app.get<Route>(
    `${racine}/:tacheId`,
    surInstance((instanceId, request) => etatLot(db, instanceId, request.params.tacheId as string)),
  );

  app.get<Route>(
    `${racine}/:tacheId/suggestions`,
    surInstance((instanceId, request) =>
      suggestionsDeLaTache(db, instanceId, request.params.tacheId as string),
    ),
  );

  app.post<Route>(
    `${racine}/:tacheId/valider`,
    surInstance(async (instanceId, request) => {
      const corps = validationSchema.safeParse(request.body);
      if (!corps.success) throw new LotRefuse('Sélection invalide');
      return valider(
        db,
        instanceId,
        request.params.tacheId as string,
        corps.data.accepter,
        corps.data.refuser,
      );
    }),
  );
}
