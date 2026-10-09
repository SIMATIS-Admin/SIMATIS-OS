import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug, listInstances } from '../instances/service.js';
import { createToken, resolveToken, revokeToken } from '../mcp/tokens.js';
import { executions } from '../routines/schema.js';
import { and, eq } from 'drizzle-orm';
import { currentInstance } from '../db/columns.js';
import { ROUTINES } from './params.js';
import { signalerPoste } from './sante.js';
import {
  DejaEnCours,
  demarrerExecution,
  echouerExecution,
  getRoutine,
  RoutineInconnue,
} from './service.js';

const UNE_HEURE = 60 * 60_000;

// API of the local runner (npm run runner): it picks the requested runs, gets a temporary MCP token
// limited to the run's instance, launches Claude, then reports the end. Only a « runner » token
// opens it.
export function registerRunnerApi(app: FastifyInstance, { db }: { db: Database }): void {
  const auth = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const resolved = token ? await resolveToken(db, token) : null;
    if (resolved?.jeton.portee !== 'runner') {
      await reply.code(401).send({ error: "Jeton d'exécuteur invalide" });
      return false;
    }
    return true;
  };

  const presence = z.object({
    nom: z.string().trim().min(1).max(200),
    claude: z.string().max(200).nullable(),
    skills: z.array(z.string().max(200)).max(500),
  });
  app.post<{ Body: unknown }>('/api/runner/presence', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const parsed = presence.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Présence invalide' });
    await signalerPoste(db, parsed.data);
    return { ok: true };
  });

  app.get('/api/runner/demandes', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const out = [];
    for (const instance of await listInstances(db)) {
      const rows = await withInstance(db, instance.id, (tx) =>
        tx
          .select()
          .from(executions)
          .where(
            and(eq(executions.instanceId, currentInstance), eq(executions.statut, 'demandee')),
          ),
      );
      for (const e of rows) {
        const skill = await withInstance(
          db,
          instance.id,
          async (tx) => (await getRoutine(tx, e.routine)).skill,
        );
        out.push({
          id: e.id,
          instance: instance.slug,
          nom: instance.nom,
          routine: e.routine,
          libelle: ROUTINES.find((r) => r.cle === e.routine)?.nom ?? e.routine,
          skill,
        });
      }
    }
    return out;
  });

  const corps = z.object({
    instance: z.string(),
    tokenId: z.uuid().optional(),
    erreur: z.string().max(2000).optional(),
  });
  type Route = { Params: { id: string }; Body: unknown };

  app.post<Route>('/api/runner/executions/:id/demarrer', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const parsed = corps.safeParse(request.body);
    const instance = parsed.success ? await getInstanceBySlug(db, parsed.data.instance) : null;
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    let execution;
    try {
      execution = await withInstance(db, instance.id, (tx) =>
        demarrerExecution(tx, request.params.id),
      );
    } catch (error) {
      if (error instanceof DejaEnCours || error instanceof RoutineInconnue) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
    const { id: tokenId, token } = await createToken(db, {
      nom: `routine:${execution.routine}`,
      portee: 'instance',
      instanceId: instance.id,
      expiresAt: new Date(Date.now() + UNE_HEURE),
    });
    return { execution, tokenId, token };
  });

  app.post<Route>('/api/runner/executions/:id/fin', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const parsed = corps.safeParse(request.body);
    const instance = parsed.success ? await getInstanceBySlug(db, parsed.data.instance) : null;
    if (!parsed.success || !instance) return reply.code(404).send({ error: 'Instance inconnue' });
    if (parsed.data.tokenId) await revokeToken(db, parsed.data.tokenId);
    const execution = await withInstance(db, instance.id, (tx) =>
      echouerExecution(
        tx,
        request.params.id,
        parsed.data.erreur ?? "La routine s'est arrêtée sans rapport.",
        'runner',
      ),
    );
    return { statut: execution.statut };
  });
}
