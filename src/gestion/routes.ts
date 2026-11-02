import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug } from '../instances/service.js';
import { logEvent } from '../journal/service.js';
import {
  archiverRevenu,
  creerRevenu,
  lireRevenu,
  modifierRevenu,
  RevenuIntrouvable,
  RevenuInvalide,
  revenuPatchSchema,
  revenuSchema,
  revenusDuMois,
} from './revenus.js';
import {
  archiverDepense,
  lireDepense,
  creerDepense,
  DepenseIntrouvable,
  DepenseInvalide,
  depensePatchSchema,
  depenseSchema,
  modifierOccurrence,
  modifierSerie,
  occurrenceSchema,
  occurrencesDepenses,
  reinitialiserOccurrence,
  syntheseDepenses,
} from './service.js';

export const MODULE_GESTION = 'gestion';

const moisSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const jourSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Gestion est réservée à « Mon activité » : instance de type `propre` avec le module activé.
export function registerGestionRoutes(app: FastifyInstance, deps: { db: Database }): void {
  const { db } = deps;

  async function dansGestion<T>(
    slug: string,
    reply: FastifyReply,
    fn: (
      tx: Parameters<Parameters<typeof withInstance<T>>[2]>[0],
      instanceId: string,
    ) => Promise<T>,
  ) {
    const instance = await getInstanceBySlug(db, slug);
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    if (instance.type !== 'propre' || !(instance.config.modules ?? []).includes(MODULE_GESTION))
      return reply.code(403).send({ error: "Gestion n'est pas activée dans cet espace." });
    try {
      return await withInstance(db, instance.id, (tx) => fn(tx, instance.id));
    } catch (e) {
      if (e instanceof DepenseIntrouvable) return reply.code(404).send({ error: e.message });
      if (e instanceof RevenuIntrouvable) return reply.code(404).send({ error: e.message });
      if (e instanceof RevenuInvalide) return reply.code(400).send({ error: e.message });
      if (e instanceof DepenseInvalide) return reply.code(400).send({ error: e.message });
      throw e;
    }
  }
  const invalide = (reply: FastifyReply) => reply.code(400).send({ error: 'Requête invalide' });

  app.get<{ Params: { slug: string }; Querystring: { mois?: string } }>(
    '/api/i/:slug/gestion/depenses',
    async (request, reply) => {
      const mois = moisSchema.safeParse(request.query.mois);
      if (!mois.success) return invalide(reply);
      return dansGestion(request.params.slug, reply, async (tx) => ({
        synthese: await syntheseDepenses(tx, mois.data),
        occurrences: await occurrencesDepenses(tx, `${mois.data}-01`, `${mois.data}-31`),
      }));
    },
  );

  app.post<{ Params: { slug: string } }>(
    '/api/i/:slug/gestion/depenses',
    async (request, reply) => {
      const parsed = depenseSchema.safeParse(request.body);
      if (!parsed.success) return invalide(reply);
      const r = await dansGestion(request.params.slug, reply, async (tx, instanceId) => {
        const d = await creerDepense(tx, instanceId, parsed.data);
        await logEvent(tx, {
          acteur: 'pilote',
          action: 'Dépense Gestion créée',
          niveau: 'L2',
          details: { depenseId: d.id },
        });
        return d;
      });
      return reply.sent ? r : reply.code(201).send(r);
    },
  );

  app.get<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/gestion/depenses/:id',
    async (request, reply) => {
      if (!z.uuid().safeParse(request.params.id).success) return invalide(reply);
      return dansGestion(request.params.slug, reply, (tx) => lireDepense(tx, request.params.id));
    },
  );

  app.patch<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/gestion/depenses/:id',
    async (request, reply) => {
      const parsed = depensePatchSchema.safeParse(request.body);
      if (!parsed.success || !z.uuid().safeParse(request.params.id).success) return invalide(reply);
      return dansGestion(request.params.slug, reply, async (tx) => {
        const d = await modifierSerie(tx, request.params.id, parsed.data);
        await logEvent(tx, {
          acteur: 'pilote',
          action: 'Dépense Gestion modifiée',
          niveau: 'L2',
          details: { depenseId: d.id },
        });
        return d;
      });
    },
  );

  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/gestion/depenses/:id',
    async (request, reply) => {
      if (!z.uuid().safeParse(request.params.id).success) return invalide(reply);
      const r = await dansGestion(request.params.slug, reply, async (tx) => {
        await archiverDepense(tx, request.params.id);
        await logEvent(tx, {
          acteur: 'pilote',
          action: 'Dépense Gestion archivée',
          niveau: 'L2',
          details: { depenseId: request.params.id },
        });
        return { ok: true };
      });
      return r;
    },
  );

  app.put<{ Params: { slug: string; id: string; date: string } }>(
    '/api/i/:slug/gestion/depenses/:id/occurrences/:date',
    async (request, reply) => {
      const parsed = occurrenceSchema.safeParse(request.body);
      if (
        !parsed.success ||
        !z.uuid().safeParse(request.params.id).success ||
        !jourSchema.safeParse(request.params.date).success
      )
        return invalide(reply);
      return dansGestion(request.params.slug, reply, async (tx, instanceId) => {
        const d = await modifierOccurrence(
          tx,
          instanceId,
          request.params.id,
          request.params.date,
          parsed.data,
        );
        await logEvent(tx, {
          acteur: 'pilote',
          action: 'Occurrence de dépense Gestion modifiée',
          niveau: 'L2',
          details: { depenseId: d.id },
        });
        return d;
      });
    },
  );

  app.delete<{ Params: { slug: string; id: string; date: string } }>(
    '/api/i/:slug/gestion/depenses/:id/occurrences/:date',
    async (request, reply) => {
      if (
        !z.uuid().safeParse(request.params.id).success ||
        !jourSchema.safeParse(request.params.date).success
      )
        return invalide(reply);
      return dansGestion(request.params.slug, reply, async (tx) => {
        await reinitialiserOccurrence(tx, request.params.id, request.params.date);
        return { ok: true };
      });
    },
  );

  app.get<{ Params: { slug: string }; Querystring: { mois?: string } }>(
    '/api/i/:slug/gestion/revenus',
    async (request, reply) => {
      const mois = moisSchema.safeParse(request.query.mois);
      if (!mois.success) return invalide(reply);
      return dansGestion(request.params.slug, reply, (tx) => revenusDuMois(tx, mois.data));
    },
  );

  app.post<{ Params: { slug: string } }>('/api/i/:slug/gestion/revenus', async (request, reply) => {
    const parsed = revenuSchema.safeParse(request.body);
    if (!parsed.success) return invalide(reply);
    const r = await dansGestion(request.params.slug, reply, async (tx, instanceId) => {
      const l = await creerRevenu(tx, instanceId, parsed.data);
      await logEvent(tx, {
        acteur: 'pilote',
        action: 'Recette Gestion créée',
        niveau: 'L2',
        details: { revenuId: l.id },
      });
      return l;
    });
    return reply.sent ? r : reply.code(201).send(r);
  });

  app.get<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/gestion/revenus/:id',
    async (request, reply) => {
      if (!z.uuid().safeParse(request.params.id).success) return invalide(reply);
      return dansGestion(request.params.slug, reply, (tx) => lireRevenu(tx, request.params.id));
    },
  );

  app.patch<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/gestion/revenus/:id',
    async (request, reply) => {
      const parsed = revenuPatchSchema.safeParse(request.body);
      if (!parsed.success || !z.uuid().safeParse(request.params.id).success) return invalide(reply);
      return dansGestion(request.params.slug, reply, async (tx) => {
        const l = await modifierRevenu(tx, request.params.id, parsed.data);
        await logEvent(tx, {
          acteur: 'pilote',
          action: 'Recette Gestion modifiée',
          niveau: 'L2',
          details: { revenuId: l.id },
        });
        return l;
      });
    },
  );

  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/gestion/revenus/:id',
    async (request, reply) => {
      if (!z.uuid().safeParse(request.params.id).success) return invalide(reply);
      return dansGestion(request.params.slug, reply, async (tx) => {
        await archiverRevenu(tx, request.params.id);
        await logEvent(tx, {
          acteur: 'pilote',
          action: 'Recette Gestion archivée',
          niveau: 'L2',
          details: { revenuId: request.params.id },
        });
        return { ok: true };
      });
    },
  );
}
