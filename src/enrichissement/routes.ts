import { lancerRecherche, lireRecherche, effacerRecherche } from './recherche-tache.js';
import { enregistrerRoutineRecherche, lireRoutineRecherche, reglagesRecherche } from './routine.js';
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
};

export const reglagesDe = (cfg: NonNullable<Config['enrichissement']>): ReglagesLot => ({
  lotMax: cfg.lotMax,
  budgetJetons: cfg.budgetJetons,
  parallelisme: PARALLELISME,
});

export function registerEnrichissementRoutes(
  app: FastifyInstance,
  { db, enrichissement, client, codex }: EnrichissementRoutesDeps,
) {
  const ia = client ?? codex ?? (enrichissement ? creerClientOpenAI(enrichissement) : null);

  const reglages =
    codex && !client
      ? { lotMax: 10, budgetJetons: Infinity, parallelisme: 1 }
      : enrichissement
        ? reglagesDe(enrichissement)
        : null;

  type Route = { Params: { slug: string; tacheId?: string }; Body: unknown };
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
      const input = z.object({ id: z.string().uuid() }).safeParse(request.body);
      if (!input.success) throw new LotRefuse('Recherche invalide.');
      await effacerRecherche(db, instanceId, input.data.id);
      return { ok: true };
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
      return reply
        .code(202)
        .send(
          await lancerRecherche(db, codex, instanceId, input.data.consignes, input.data.nombre),
        );
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
