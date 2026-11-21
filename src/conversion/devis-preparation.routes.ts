import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug, listInstances } from '../instances/service.js';
import { devisActif } from './devis.js';
import {
  devisAPreparer,
  poserPreparation,
  propositionPerimetreSchema,
} from './devis-preparation.js';

// Interface de l'exécuteur : il lit les demandes « Préparer avec Claude » et rend la proposition.
export function registerDevisPreparationRunnerRoutes(
  app: FastifyInstance,
  {
    db,
    auth,
  }: { db: Database; auth: (request: FastifyRequest, reply: FastifyReply) => Promise<boolean> },
): void {
  app.get('/api/runner/devis-preparations', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const out = [];
    for (const instance of await listInstances(db)) {
      if (!devisActif(instance)) continue;
      const rows = await withInstance(db, instance.id, (tx) => devisAPreparer(tx));
      for (const r of rows) out.push({ ...r, instance: instance.slug });
    }
    return out;
  });

  const rendu = z.object({
    instance: z.string().min(1),
    propose: propositionPerimetreSchema.optional(),
    erreur: z.string().max(300).optional(),
  });
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/runner/devis-preparations/:id',
    async (request, reply) => {
      if (!(await auth(request, reply))) return reply;
      const corps = rendu.safeParse(request.body);
      if (!corps.success || !(corps.data.propose || corps.data.erreur)) {
        return reply.code(400).send({ error: 'Proposition invalide' });
      }
      const cible = await getInstanceBySlug(db, corps.data.instance);
      if (!cible) return reply.code(404).send({ error: 'Instance inconnue' });
      const { propose, erreur } = corps.data;
      const pose = await withInstance(db, cible.id, (tx) =>
        poserPreparation(tx, request.params.id, propose ? { propose } : { erreur: erreur ?? '' }),
      );
      return { ok: pose };
    },
  );
}
