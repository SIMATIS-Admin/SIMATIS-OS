import type { FastifyInstance } from 'fastify';
import type { Database } from '../db.js';
import type { FetchLike } from '../connecteurs/google/oauth.js';
import { getInstanceBySlug } from '../instances/service.js';
import { creerVisio, EntrepriseIntrouvable, visioSchema } from './service.js';

export type VisioRoutesDeps = {
  db: Database;
  secretsDir: string;
  realWrites: boolean;
  googleFetch?: FetchLike;
  hote: string;
};

export function registerVisioRoutes(app: FastifyInstance, deps: VisioRoutesDeps): void {
  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/visios',
    async (request, reply) => {
      const instance = await getInstanceBySlug(deps.db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      const parsed = visioSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: parsed.error.issues[0]?.message ?? 'Requête invalide' });
      }
      try {
        const cree = await creerVisio(deps.db, instance, parsed.data, {
          secretsDir: deps.secretsDir,
          realWrites: deps.realWrites,
          hote: deps.hote,
          ...(deps.googleFetch ? { fetch: deps.googleFetch } : {}),
        });
        return reply.code(201).send(cree);
      } catch (e) {
        if (e instanceof EntrepriseIntrouvable) return reply.code(404).send({ error: e.message });
        throw e;
      }
    },
  );
}
