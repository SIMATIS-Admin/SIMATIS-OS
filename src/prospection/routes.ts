import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug } from '../instances/service.js';
import {
  ajouterSignature,
  definirDefaut,
  imageSignature,
  listerSignatures,
  reglerObjectif,
  remplacerImage,
  renommerSignature,
  SignatureIntrouvable,
  SignatureInvalide,
  supprimerSignature,
} from './signatures.js';
import { statsProspection } from './stats.js';

export type ProspectionRoutesDeps = { db: Database };

const imageSchema = z.object({
  typeMime: z.string().max(40),
  imageBase64: z.string().max(700_000),
});
const creationSchema = imageSchema.extend({ nom: z.string().max(200) });
const modificationSchema = z.object({
  nom: z.string().max(200).optional(),
  defaut: z.boolean().optional(),
});
const objectifSchema = z.object({ objectif: z.number() });

export function registerProspectionRoutes(app: FastifyInstance, deps: ProspectionRoutesDeps): void {
  const { db } = deps;

  const erreur = (e: unknown, reply: FastifyReply) => {
    if (e instanceof SignatureIntrouvable) return reply.code(404).send({ error: e.message });
    if (e instanceof SignatureInvalide) return reply.code(400).send({ error: e.message });
    throw e;
  };
  const invalide = (reply: FastifyReply, issue?: string) =>
    reply.code(400).send({ error: issue ?? 'Requête invalide' });

  // Résout l'instance du chemin, puis exécute `fn` dans son contexte (cloisonnement par Postgres).
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

  app.get<{ Params: { slug: string } }>('/api/i/:slug/prospection', (request, reply) =>
    dansInstance(request.params.slug, reply, async (tx) => ({
      stats: await statsProspection(tx),
      signatures: await listerSignatures(tx),
      // Les campagnes récentes arrivent avec les livraisons suivantes.
      recentes: [],
    })),
  );

  app.put<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/prospection/objectif',
    (request, reply) => {
      const p = objectifSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, "L'objectif doit être un nombre.");
      return dansInstance(request.params.slug, reply, async (tx) => {
        await reglerObjectif(tx, p.data.objectif);
        return { ok: true };
      });
    },
  );

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/prospection/signatures',
    async (request, reply) => {
      const p = creationSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, p.error.issues[0]?.message);
      const s = await dansInstance(request.params.slug, reply, (tx) =>
        ajouterSignature(tx, p.data),
      );
      return reply.sent ? undefined : reply.code(201).send(s);
    },
  );

  app.patch<{ Params: { slug: string; id: string }; Body: unknown }>(
    '/api/i/:slug/prospection/signatures/:id',
    (request, reply) => {
      const p = modificationSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, p.error.issues[0]?.message);
      return dansInstance(request.params.slug, reply, async (tx) => {
        if (p.data.nom !== undefined) await renommerSignature(tx, request.params.id, p.data.nom);
        if (p.data.defaut !== undefined) {
          await definirDefaut(tx, p.data.defaut ? request.params.id : null);
        }
        return { ok: true };
      });
    },
  );

  app.put<{ Params: { slug: string; id: string }; Body: unknown }>(
    '/api/i/:slug/prospection/signatures/:id/image',
    (request, reply) => {
      const p = imageSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, p.error.issues[0]?.message);
      return dansInstance(request.params.slug, reply, async (tx) => {
        await remplacerImage(tx, request.params.id, p.data);
        return { ok: true };
      });
    },
  );

  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/prospection/signatures/:id',
    (request, reply) =>
      dansInstance(request.params.slug, reply, async (tx) => {
        await supprimerSignature(tx, request.params.id);
        return { ok: true };
      }),
  );

  app.get<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/prospection/signatures/:id/image',
    async (request, reply) => {
      const img = await dansInstance(request.params.slug, reply, (tx) =>
        imageSignature(tx, request.params.id),
      );
      if (reply.sent) return undefined;
      if (!img) return reply.code(404).send({ error: 'Signature introuvable.' });
      return reply
        .header('Content-Type', img.typeMime)
        .header('Cache-Control', 'private, max-age=300')
        .send(img.octets);
    },
  );
}
