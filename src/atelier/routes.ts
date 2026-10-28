import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db.js';
import { getInstanceBySlug } from '../instances/service.js';
import { creationSchema, importSchema, patchSchema } from './saisie.js';
import {
  AtelierIndisponible,
  AtelierIntrouvable,
  createAtelier,
  deleteAtelier,
  EntrepriseIntrouvable,
  getAtelier,
  listAteliers,
  updateAtelier,
} from './service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const erreur = (e: unknown, reply: FastifyReply) => {
  if (e instanceof AtelierIndisponible) return reply.code(403).send({ error: e.message });
  if (e instanceof AtelierIntrouvable) return reply.code(404).send({ error: e.message });
  if (e instanceof EntrepriseIntrouvable) return reply.code(400).send({ error: e.message });
  throw e;
};

export function registerAtelierRoutes(app: FastifyInstance, deps: { db: Database }): void {
  const { db } = deps;
  // Une seule forme de route : « id » et « Body » ne servent que là où la route les déclare.
  type Rt = { Params: { slug: string; id: string }; Body: unknown };

  // Résout l'instance puis exécute l'action ; les refus du service deviennent des codes HTTP.
  const surInstance =
    (
      action: (
        instance: NonNullable<Awaited<ReturnType<typeof getInstanceBySlug>>>,
        request: FastifyRequest<Rt>,
        reply: FastifyReply,
      ) => unknown,
    ) =>
    async (request: FastifyRequest<Rt>, reply: FastifyReply) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      try {
        return await Promise.resolve(action(instance, request, reply));
      } catch (e) {
        return erreur(e, reply);
      }
    };

  const invalide = (reply: FastifyReply, message?: string) =>
    reply.code(400).send({ error: message ?? 'Atelier invalide' });

  app.get<Rt>(
    '/api/i/:slug/ateliers-strategie',
    surInstance((instance) => listAteliers(db, instance)),
  );

  app.post<Rt>(
    '/api/i/:slug/ateliers-strategie',
    surInstance((instance, request, reply) => {
      const parsed = creationSchema.safeParse(request.body);
      if (!parsed.success) return invalide(reply, parsed.error.issues[0]?.message);
      return createAtelier(db, instance, parsed.data);
    }),
  );

  // Déclaré avant « :id » pour que « import » ne soit pas lu comme un identifiant.
  app.post<Rt>(
    '/api/i/:slug/ateliers-strategie/import',
    surInstance((instance, request, reply) => {
      const parsed = importSchema.safeParse(request.body);
      if (!parsed.success) return invalide(reply, 'Fichier de sauvegarde invalide');
      const { entrepriseId, titre, sauvegarde } = parsed.data;
      return createAtelier(db, instance, {
        entrepriseId,
        titre,
        etat: sauvegarde.steps_state,
      });
    }),
  );

  app.get<Rt>(
    '/api/i/:slug/ateliers-strategie/:id',
    surInstance((instance, request, reply) =>
      UUID.test(request.params.id)
        ? getAtelier(db, instance, request.params.id)
        : invalide(reply, 'Atelier invalide'),
    ),
  );

  app.patch<Rt>(
    '/api/i/:slug/ateliers-strategie/:id',
    surInstance((instance, request, reply) => {
      if (!UUID.test(request.params.id)) return invalide(reply, 'Atelier invalide');
      const parsed = patchSchema.safeParse(request.body);
      if (!parsed.success) return invalide(reply, parsed.error.issues[0]?.message);
      return updateAtelier(db, instance, request.params.id, parsed.data);
    }),
  );

  app.delete<Rt>(
    '/api/i/:slug/ateliers-strategie/:id',
    surInstance(async (instance, request, reply) => {
      if (!UUID.test(request.params.id)) return invalide(reply, 'Atelier invalide');
      await deleteAtelier(db, instance, request.params.id);
      return { ok: true };
    }),
  );
}
