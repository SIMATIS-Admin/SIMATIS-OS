import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug, listInstances } from '../instances/service.js';
import { createToken, resolveToken, revokeToken } from '../mcp/tokens.js';
import { executions } from '../routines/schema.js';
import { echangesAjout } from '../inbox/schema.js';
import { demarrerEchange, EchangeInconnu, EchangeRefuse, finirEchange } from '../inbox/echanges.js';
import {
  attentesClaude,
  ChatIndisponible,
  demarrerAttente,
  finirAttente,
} from '../diagnostic/chat.js';
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
const UN_QUART_HEURE = 15 * 60_000;

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
          // A demo never gets the second brain, whatever its routine.
          cerveau:
            ROUTINES.find((r) => r.cle === e.routine)?.cerveau === true &&
            instance.type !== 'prospect',
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

  // Conversations du diagnostic en attente de Claude (un projet à la fois, comme l'Inbox).
  app.get('/api/runner/diagnostic/attentes', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    return attentesClaude(db);
  });

  app.post<Route>('/api/runner/diagnostic/attentes/:id/demarrer', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const parsed = corps.safeParse(request.body);
    const instance = parsed.success ? await getInstanceBySlug(db, parsed.data.instance) : null;
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    try {
      await demarrerAttente(db, instance, request.params.id);
    } catch (error) {
      if (error instanceof ChatIndisponible) return reply.code(409).send({ error: error.message });
      throw error;
    }
    const { id: tokenId, token } = await createToken(db, {
      nom: 'diagnostic-chat',
      portee: 'instance',
      instanceId: instance.id,
      expiresAt: new Date(Date.now() + UN_QUART_HEURE),
    });
    return { tokenId, token };
  });

  app.post<Route>('/api/runner/diagnostic/attentes/:id/fin', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const parsed = corps.safeParse(request.body);
    const instance = parsed.success ? await getInstanceBySlug(db, parsed.data.instance) : null;
    if (!parsed.success || !instance) return reply.code(404).send({ error: 'Instance inconnue' });
    if (parsed.data.tokenId) await revokeToken(db, parsed.data.tokenId);
    await finirAttente(db, instance, request.params.id, parsed.data.erreur);
    return { ok: true };
  });

  // Add conversations of the Inbox waiting for Claude, with what was said so far.
  app.get('/api/runner/echanges', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const out = [];
    for (const instance of await listInstances(db)) {
      const rows = await withInstance(db, instance.id, (tx) =>
        tx
          .select()
          .from(echangesAjout)
          .where(
            and(
              eq(echangesAjout.instanceId, currentInstance),
              eq(echangesAjout.statut, 'attente_claude'),
            ),
          ),
      );
      for (const e of rows) {
        out.push({
          id: e.id,
          instance: instance.slug,
          nom: instance.nom,
          messages: e.messages,
          brouillon: e.brouillon,
        });
      }
    }
    return out;
  });

  app.post<Route>('/api/runner/echanges/:id/demarrer', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const parsed = corps.safeParse(request.body);
    const instance = parsed.success ? await getInstanceBySlug(db, parsed.data.instance) : null;
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    try {
      await withInstance(db, instance.id, (tx) => demarrerEchange(tx, request.params.id));
    } catch (error) {
      if (error instanceof EchangeRefuse || error instanceof EchangeInconnu) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
    const { id: tokenId, token } = await createToken(db, {
      nom: 'ajout-inbox',
      portee: 'instance',
      instanceId: instance.id,
      expiresAt: new Date(Date.now() + UN_QUART_HEURE),
    });
    return { tokenId, token };
  });

  app.post<Route>('/api/runner/echanges/:id/fin', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const parsed = corps.safeParse(request.body);
    const instance = parsed.success ? await getInstanceBySlug(db, parsed.data.instance) : null;
    if (!parsed.success || !instance) return reply.code(404).send({ error: 'Instance inconnue' });
    if (parsed.data.tokenId) await revokeToken(db, parsed.data.tokenId);
    const echange = await withInstance(db, instance.id, (tx) =>
      finirEchange(
        tx,
        request.params.id,
        parsed.data.erreur ?? "Claude n'a pas répondu. Réécrivez votre message pour réessayer.",
      ),
    );
    return { statut: echange.statut };
  });
}
