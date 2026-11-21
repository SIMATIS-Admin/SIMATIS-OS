import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug, listInstances } from '../instances/service.js';
import { poserResume, RESUME_MAX, sessionsAResumer } from './resume.js';

// Interface de l'exécuteur : il lit les visios à résumer et rend le résumé rédigé par Claude.
export function registerResumeRunnerRoutes(
  app: FastifyInstance,
  {
    db,
    auth,
  }: { db: Database; auth: (request: FastifyRequest, reply: FastifyReply) => Promise<boolean> },
): void {
  app.get('/api/runner/resumes', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const out = [];
    for (const instance of await listInstances(db)) {
      const rows = await withInstance(db, instance.id, (tx) => sessionsAResumer(tx));
      for (const r of rows) {
        out.push({
          id: r.id,
          instance: instance.slug,
          titre: r.titre,
          transcript: r.transcript,
          // Heures réelles de l'enregistrement ; à défaut de fin, celle de l'agenda.
          debut: r.debut,
          fin: r.finEnregistrement ?? r.finRendezVous,
          participants: r.participants,
        });
      }
    }
    return out;
  });

  const rendu = z.object({
    instance: z.string().min(1),
    resume: z.string().trim().min(1).max(RESUME_MAX),
  });
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/runner/resumes/:id',
    async (request, reply) => {
      if (!(await auth(request, reply))) return reply;
      const corps = rendu.safeParse(request.body);
      const instance = z.object({ instance: z.string() }).safeParse(request.body);
      const cible = instance.success ? await getInstanceBySlug(db, instance.data.instance) : null;
      if (!cible) return reply.code(404).send({ error: 'Instance inconnue' });
      if (!corps.success) return reply.code(400).send({ error: 'Résumé invalide' });
      const pose = await withInstance(db, cible.id, (tx) =>
        poserResume(tx, request.params.id, corps.data.resume),
      );
      if (!pose) return reply.code(404).send({ error: 'Session introuvable' });
      return { ok: true };
    },
  );
}
