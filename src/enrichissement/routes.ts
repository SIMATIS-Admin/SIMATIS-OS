import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug } from '../instances/service.js';
import { creerClientOpenAI, type ClientIA } from './client.js';
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
};

export const reglagesDe = (cfg: NonNullable<Config['enrichissement']>): ReglagesLot => ({
  lotMax: cfg.lotMax,
  budgetJetons: cfg.budgetJetons,
  parallelisme: PARALLELISME,
});

export function registerEnrichissementRoutes(
  app: FastifyInstance,
  { db, enrichissement, client }: EnrichissementRoutesDeps,
) {
  const ia = client ?? (enrichissement ? creerClientOpenAI(enrichissement) : null);

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
        disponible: enrichissement !== null,
        lotMax: enrichissement?.lotMax ?? 0,
        tacheEnCours: actif?.id ?? null,
      };
    }),
  );

  app.post<Route>(
    racine,
    surInstance(async (instanceId, request, reply) => {
      if (!enrichissement || !ia)
        return reply.code(409).send({ error: 'Clé OpenAI absente : enrichissement indisponible' });
      const corps = lancementSchema.safeParse(request.body);
      if (!corps.success) throw new LotRefuse('Paramètres d’enrichissement invalides');
      const tache = await lancerLot(db, ia, reglagesDe(enrichissement), instanceId, corps.data);
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
