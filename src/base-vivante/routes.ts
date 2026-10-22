import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { getInstanceBySlug } from '../instances/service.js';
import { ZONES } from './completude.js';
import { FichierIllisible } from './lecture.js';
import {
  annulerImport,
  apercu,
  completerLigne,
  creerImports,
  FILTRES_LIGNES,
  ImportIntrouvable,
  ImportRefuse,
  integrerImport,
  listerFiches,
  listerImports,
  reglerCorrespondance,
} from './service.js';
import { FicheNonHomogene } from './integration.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const creationSchema = z
  .object({
    nomFichier: z.string().trim().min(1, 'Nom du fichier manquant').max(255),
    contenuBase64: z.string().min(1).optional(),
    texte: z.string().min(1).optional(),
    provenance: z.string().trim().min(1, 'Indiquez la source de la liste').max(120),
    mandat: z.string().trim().max(120).nullish(),
    collecteLe: z.iso.date().nullish(),
  })
  .refine((c) => c.contenuBase64 || c.texte, 'Fichier ou texte manquant');

const correspondanceSchema = z.object({
  correspondance: z.record(z.string(), z.number().int().nullable()),
});

const completementSchema = z.object({
  entreprise: z.string().max(200).optional(),
  prenom: z.string().max(120).optional(),
  nom: z.string().max(120).optional(),
  email: z.string().max(200).optional(),
  telephone: z.string().max(60).optional(),
  fonction: z.string().max(200).optional(),
});

export type BaseVivanteRoutesDeps = { db: Database };

export function registerBaseVivanteRoutes(app: FastifyInstance, { db }: BaseVivanteRoutesDeps) {
  const erreur = (error: unknown, reply: FastifyReply) => {
    if (error instanceof ImportIntrouvable) return reply.code(404).send({ error: error.message });
    if (
      error instanceof ImportRefuse ||
      error instanceof FichierIllisible ||
      error instanceof FicheNonHomogene
    )
      return reply.code(400).send({ error: error.message });
    throw error;
  };

  type Route = {
    Params: { slug: string; id?: string; numero?: string };
    Querystring: { zone?: string; q?: string; page?: string; statut?: string };
    Body: unknown;
  };

  const surInstance =
    (f: (instanceId: string, request: FastifyRequest<Route>) => Promise<unknown>) =>
    async (request: FastifyRequest<Route>, reply: FastifyReply) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      const id = request.params.id;
      if (id !== undefined && !UUID.test(id))
        return reply.code(400).send({ error: 'Import invalide' });
      try {
        return await f(instance.id, request);
      } catch (error) {
        return erreur(error, reply);
      }
    };

  app.get<Route>(
    '/api/i/:slug/base',
    surInstance(async (instanceId, request) => {
      const zone = ZONES.find((z) => z === request.query.zone);
      const page = Math.max(0, Number(request.query.page) || 0);
      const liste = await listerFiches(db, instanceId, {
        zone,
        q: request.query.q,
        limite: 50,
        decalage: page * 50,
      });
      return { ...liste, imports: await listerImports(db, instanceId) };
    }),
  );

  app.post<Route>(
    '/api/i/:slug/base/imports',
    { bodyLimit: 60_000_000 },
    surInstance(async (instanceId, request) => {
      const corps = creationSchema.safeParse(request.body);
      if (!corps.success)
        throw new ImportRefuse(corps.error.issues[0]?.message ?? 'Import invalide');
      const imports = await creerImports(db, instanceId, {
        nomFichier: corps.data.nomFichier,
        contenu: corps.data.contenuBase64
          ? Buffer.from(corps.data.contenuBase64, 'base64')
          : undefined,
        texte: corps.data.texte,
        provenance: corps.data.provenance,
        mandat: corps.data.mandat ?? null,
        collecteLe: corps.data.collecteLe ?? null,
      });
      return imports;
    }),
  );

  app.get<Route>(
    '/api/i/:slug/base/imports/:id',
    surInstance(async (instanceId, request) => {
      const filtre = FILTRES_LIGNES.find((f) => f === request.query.statut);
      return apercu(db, instanceId, request.params.id as string, filtre);
    }),
  );

  app.put<Route>(
    '/api/i/:slug/base/imports/:id/correspondance',
    surInstance(async (instanceId, request) => {
      const corps = correspondanceSchema.safeParse(request.body);
      if (!corps.success) throw new ImportRefuse('Correspondance invalide');
      return reglerCorrespondance(
        db,
        instanceId,
        request.params.id as string,
        corps.data.correspondance,
      );
    }),
  );

  app.patch<Route>(
    '/api/i/:slug/base/imports/:id/lignes/:numero',
    surInstance(async (instanceId, request) => {
      const corps = completementSchema.safeParse(request.body);
      const numero = Number(request.params.numero);
      if (!corps.success || !Number.isInteger(numero) || numero < 1)
        throw new ImportRefuse('Complément invalide');
      return completerLigne(db, instanceId, request.params.id as string, numero, corps.data);
    }),
  );

  app.post<Route>(
    '/api/i/:slug/base/imports/:id/integrer',
    surInstance((instanceId, request) =>
      integrerImport(db, instanceId, request.params.id as string),
    ),
  );

  app.delete<Route>(
    '/api/i/:slug/base/imports/:id',
    surInstance(async (instanceId, request) => {
      await annulerImport(db, instanceId, request.params.id as string);
      return { ok: true };
    }),
  );
}
