import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug } from '../instances/service.js';
import {
  CampagneIntrouvable,
  creerCampagne,
  LIMITE_INVITATION,
  listerCampagnes,
  listerModeles,
  messageEffectif,
  ModeleInvalide,
  rendre,
  retirerSurcharge,
  sauverModele,
  sauverSurcharge,
  supprimerCampagne,
} from './modeles.js';
import { ActionInvalide, ActionRefusee, enregistrerAction, indicateurs } from './actions.js';
import { lireReglages, ReglageInvalide, sauverReglages } from './reglages.js';
import { ETAPES_SALESNAV } from './schema.js';

export type SalesnavRoutesDeps = { db: Database };

const texteSchema = z.object({ texte: z.string().max(10_000) });
const campagneSchema = z.object({ nom: z.string().max(200), icp: z.string().max(200) });
const reglagesSchema = z.object({
  quotaJour: z.number().optional(),
  pause: z.boolean().optional(),
});
const actionSchema = z.object({
  type: z.string().max(40),
  opportuniteId: z.uuid().nullable().optional(),
  campagneId: z.uuid().nullable().optional(),
});
const variablesSchema = z.object({
  prenom: z.string().max(200).optional(),
  entreprise: z.string().max(200).optional(),
});

export function registerSalesnavRoutes(app: FastifyInstance, deps: SalesnavRoutesDeps): void {
  const { db } = deps;

  const erreur = (e: unknown, reply: FastifyReply) => {
    if (e instanceof CampagneIntrouvable) return reply.code(404).send({ error: e.message });
    if (e instanceof ActionRefusee) return reply.code(409).send({ error: e.message });
    if (e instanceof ActionInvalide) return reply.code(400).send({ error: e.message });
    if (e instanceof ModeleInvalide || e instanceof ReglageInvalide)
      return reply.code(400).send({ error: e.message });
    throw e;
  };
  const invalide = (reply: FastifyReply, issue?: string) =>
    reply.code(400).send({ error: issue ?? 'Requête invalide' });

  async function dansInstance<T>(
    slug: string,
    reply: FastifyReply,
    fn: Parameters<typeof withInstance<T>>[2],
  ) {
    const instance = await getInstanceBySlug(db, slug);
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    try {
      return await withInstance(db, instance.id, fn);
    } catch (e) {
      return erreur(e, reply);
    }
  }

  app.get<{ Params: { slug: string } }>('/api/i/:slug/salesnav/reglages', (request, reply) =>
    dansInstance(request.params.slug, reply, (tx) => lireReglages(tx)),
  );

  app.put<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/reglages',
    (request, reply) => {
      const p = reglagesSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, 'Réglage invalide');
      return dansInstance(request.params.slug, reply, (tx) => sauverReglages(tx, p.data));
    },
  );

  // Les compteurs du jour et de la semaine : sous-section SalesNav et barre de l'état commercial.
  app.get<{ Params: { slug: string } }>('/api/i/:slug/salesnav/indicateurs', (request, reply) =>
    dansInstance(request.params.slug, reply, (tx) => indicateurs(tx)),
  );

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/actions',
    async (request, reply) => {
      const p = actionSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, 'Action invalide');
      const r = await dansInstance(request.params.slug, reply, async (tx) => {
        await enregistrerAction(tx, p.data);
        return indicateurs(tx);
      });
      return reply.sent ? undefined : reply.code(201).send(r);
    },
  );

  // Tout ce que l'écran affiche : étapes, limite, modèles par défaut, campagnes et leurs surcharges.
  app.get<{ Params: { slug: string } }>('/api/i/:slug/salesnav/modeles', (request, reply) =>
    dansInstance(request.params.slug, reply, async (tx) => ({
      etapes: ETAPES_SALESNAV,
      limiteInvitation: LIMITE_INVITATION,
      modeles: await listerModeles(tx),
      campagnes: await listerCampagnes(tx),
    })),
  );

  app.put<{ Params: { slug: string; icp: string; etape: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/modeles/:icp/:etape',
    (request, reply) => {
      const p = texteSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, p.error.issues[0]?.message);
      return dansInstance(request.params.slug, reply, async (tx) => {
        await sauverModele(tx, request.params.icp, request.params.etape, p.data.texte);
        return { ok: true };
      });
    },
  );

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/campagnes',
    async (request, reply) => {
      const p = campagneSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, p.error.issues[0]?.message);
      const c = await dansInstance(request.params.slug, reply, (tx) => creerCampagne(tx, p.data));
      return reply.sent ? undefined : reply.code(201).send(c);
    },
  );

  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/salesnav/campagnes/:id',
    (request, reply) =>
      dansInstance(request.params.slug, reply, async (tx) => {
        await supprimerCampagne(tx, request.params.id);
        return { ok: true };
      }),
  );

  app.put<{ Params: { slug: string; id: string; etape: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/campagnes/:id/modeles/:etape',
    (request, reply) => {
      const p = texteSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, p.error.issues[0]?.message);
      return dansInstance(request.params.slug, reply, async (tx) => {
        await sauverSurcharge(tx, request.params.id, request.params.etape, p.data.texte);
        return { ok: true };
      });
    },
  );

  app.delete<{ Params: { slug: string; id: string; etape: string } }>(
    '/api/i/:slug/salesnav/campagnes/:id/modeles/:etape',
    (request, reply) =>
      dansInstance(request.params.slug, reply, async (tx) => {
        await retirerSurcharge(tx, request.params.id, request.params.etape);
        return { ok: true };
      }),
  );

  // Le message prêt à copier pour un contact : texte de la campagne ou du modèle, variables remplies.
  app.post<{ Params: { slug: string; id: string; etape: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/campagnes/:id/messages/:etape',
    (request, reply) => {
      const p = variablesSchema.safeParse(request.body ?? {});
      if (!p.success) return invalide(reply, p.error.issues[0]?.message);
      return dansInstance(request.params.slug, reply, async (tx) => {
        const m = await messageEffectif(tx, request.params.id, request.params.etape);
        return { origine: m.origine, ...rendre(m.texte, p.data) };
      });
    },
  );
}
