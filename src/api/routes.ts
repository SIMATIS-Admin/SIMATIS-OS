import type { FastifyInstance, FastifyReply } from 'fastify';
import { searchContacts, searchEntreprises } from '../crm/service.js';
import type { Database } from '../db.js';
import { getInstanceBySlug, listInstances } from '../instances/service.js';

type InstanceRoute = { Params: { slug: string }; Querystring: { q?: string } };

export function registerApi(app: FastifyInstance, { db }: { db: Database }): void {
  app.get('/api/instances', async () =>
    (await listInstances(db)).map((i) => ({
      slug: i.slug,
      nom: i.nom,
      sous: i.config.sous ?? '',
      type: i.type,
      couleur: i.config.couleur ?? '#41A594',
      modules: i.config.modules ?? [],
    })),
  );

  const withInstance =
    (list: (instanceId: string, q: string) => Promise<unknown>) =>
    async (
      request: { params: InstanceRoute['Params']; query: InstanceRoute['Querystring'] },
      reply: FastifyReply,
    ) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      return list(instance.id, request.query.q ?? '');
    };

  app.get<InstanceRoute>(
    '/api/i/:slug/entreprises',
    withInstance((id, q) => searchEntreprises(db, id, q)),
  );
  app.get<InstanceRoute>(
    '/api/i/:slug/contacts',
    withInstance((id, q) => searchContacts(db, id, q)),
  );
}
