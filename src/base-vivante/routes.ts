import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FetchLike } from '../connecteurs/google/oauth.js';
import type { Database } from '../db.js';
import { instances } from '../instances/schema.js';
import { getInstanceBySlug, listInstances } from '../instances/service.js';
import { ZONES } from './completude.js';
import { actualiserHistorique } from './historique.js';
import {
  etatRapprochement,
  lancerRapprochement,
  RapprochementImpossible,
  verifierMessagerie,
} from './rapprochement.js';
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
  exporterCsv,
  FILTRES_ALERTE,
  listerFiches,
  modifierConformite,
  type FiltresBase,
  listerImports,
  reglerCorrespondance,
} from './service.js';
import {
  ClasseRefusee,
  CLASSES,
  ReponseIntrouvable,
  reponsesAClasser,
  reponsesAValider,
  validerReponse,
} from './reponses.js';
import { entrerDansCrm, entrerRepondants } from './vers-crm.js';
import { FicheIntrouvable, FicheNonHomogene } from './integration.js';
import { EXCLUSIONS, STATUTS_PROSPECTION } from './schema.js';

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

const validationSchema = z.object({ classe: z.enum(CLASSES).optional() });

const debutSchema = z.object({ debut: z.iso.date().nullable() });

const rapprochementSchema = z.object({
  mandat: z.string().min(1).max(63),
  depuis: z.iso.date().nullish(),
});

const conformiteSchema = z
  .object({
    opposition: z.boolean().optional(),
    emailInvalide: z.boolean().optional(),
    exclusion: z.enum(EXCLUSIONS).nullable().optional(),
  })
  .strict();

export type BaseVivanteRoutesDeps = {
  db: Database;
  secretsDir?: string;
  realWrites?: boolean;
  googleFetch?: FetchLike;
};

export function registerBaseVivanteRoutes(
  app: FastifyInstance,
  {
    db,
    secretsDir = './secrets/instances',
    realWrites = false,
    googleFetch,
  }: BaseVivanteRoutesDeps,
) {
  const erreur = (error: unknown, reply: FastifyReply) => {
    if (
      error instanceof ImportIntrouvable ||
      error instanceof FicheIntrouvable ||
      error instanceof ReponseIntrouvable
    )
      return reply.code(404).send({ error: error.message });
    if (
      error instanceof ImportRefuse ||
      error instanceof FichierIllisible ||
      error instanceof FicheNonHomogene ||
      error instanceof RapprochementImpossible ||
      error instanceof ClasseRefusee
    )
      return reply.code(400).send({ error: error.message });
    throw error;
  };

  type Route = {
    Params: { slug: string; id?: string; numero?: string; mandat?: string };
    Querystring: {
      zone?: string;
      q?: string;
      page?: string;
      statut?: string;
      alerte?: string;
      provenance?: string;
    };
    Body: unknown;
  };

  const surInstance =
    (
      f: (
        instanceId: string,
        request: FastifyRequest<Route>,
        reply: FastifyReply,
      ) => Promise<unknown>,
    ) =>
    async (request: FastifyRequest<Route>, reply: FastifyReply) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      const id = request.params.id;
      if (id !== undefined && !UUID.test(id))
        return reply.code(400).send({ error: 'Identifiant invalide' });
      try {
        return await f(instance.id, request, reply);
      } catch (error) {
        return erreur(error, reply);
      }
    };

  // Mandates whose mailbox can be read, with the date their history starts from.
  app.get<Route>(
    '/api/i/:slug/base/mandats',
    surInstance(async () =>
      (await listInstances(db))
        .filter((i) => i.type === 'mandat')
        .map((i) => ({ slug: i.slug, nom: i.nom, debutMandat: i.config.debutMandat ?? null })),
    ),
  );

  app.put<Route>(
    '/api/i/:slug/base/mandats/:mandat',
    surInstance(async (_instanceId, request) => {
      const corps = debutSchema.safeParse(request.body);
      const mandat = await getInstanceBySlug(db, request.params.mandat as string);
      if (!corps.success || mandat?.type !== 'mandat') throw new ImportRefuse('Date invalide');
      const reste = { ...mandat.config };
      delete reste.debutMandat;
      await db
        .update(instances)
        .set({
          config: corps.data.debut ? { ...reste, debutMandat: corps.data.debut } : reste,
          updatedAt: new Date(),
        })
        .where(eq(instances.id, mandat.id));
      return { ok: true };
    }),
  );

  app.get<Route>(
    '/api/i/:slug/base/rapprochement-mail',
    surInstance((instanceId) => Promise.resolve(etatRapprochement(instanceId))),
  );

  app.post<Route>(
    '/api/i/:slug/base/rapprochement-mail',
    surInstance(async (instanceId, request, reply) => {
      const corps = rapprochementSchema.safeParse(request.body);
      if (!corps.success) throw new ImportRefuse('Mandat ou date invalide');
      const base = await getInstanceBySlug(db, request.params.slug);
      const mandat = await getInstanceBySlug(db, corps.data.mandat);
      if (!base || mandat?.type !== 'mandat') throw new ImportRefuse('Mandat inconnu');
      const debut = corps.data.depuis ?? mandat.config.debutMandat;
      if (!debut)
        throw new ImportRefuse(
          `Indiquez la date de début du mandat de ${mandat.nom} : l'historique de la boîte est lu à partir de là.`,
        );
      await verifierMessagerie(db, mandat);
      void instanceId;
      const etat = lancerRapprochement(
        db,
        { secretsDir, ...(googleFetch ? { fetch: googleFetch } : {}) },
        base,
        mandat,
        new Date(`${debut}T00:00:00Z`),
      );
      return reply.code(202).send(etat);
    }),
  );

  app.get<Route>(
    '/api/i/:slug/base/reponses',
    surInstance(async (instanceId) => ({
      aValider: await reponsesAValider(db, instanceId),
      aClasser: (await reponsesAClasser(db, instanceId, 200)).length,
    })),
  );

  app.post<Route>(
    '/api/i/:slug/base/reponses/:id/valider',
    surInstance(async (instanceId, request) => {
      const corps = validationSchema.safeParse(request.body ?? {});
      if (!corps.success) throw new ImportRefuse('Classe invalide');
      await validerReponse(db, instanceId, request.params.id as string, corps.data.classe);
      return { ok: true };
    }),
  );

  // From the base to the CRM of the mandate that wrote: only the answerers, never a record to
  // enrich; HubSpot mandates follow their double lock (simulation unless real writes are on).
  app.post<Route>(
    '/api/i/:slug/base/crm/repondants',
    surInstance((instanceId) => entrerRepondants(db, { secretsDir, realWrites }, instanceId)),
  );

  app.post<Route>(
    '/api/i/:slug/base/fiches/:id/crm',
    surInstance((instanceId, request) =>
      entrerDansCrm(db, { secretsDir, realWrites }, instanceId, request.params.id as string),
    ),
  );

  const filtresDe = (q: Route['Querystring']): FiltresBase => ({
    zone: ZONES.find((z) => z === q.zone),
    statut: STATUTS_PROSPECTION.find((s) => s === q.statut),
    alerte: FILTRES_ALERTE.find((a) => a === q.alerte),
    provenance: q.provenance?.trim() || undefined,
    q: q.q,
  });

  app.get<Route>(
    '/api/i/:slug/base',
    surInstance(async (instanceId, request) => {
      const page = Math.max(0, Number(request.query.page) || 0);
      const liste = await listerFiches(db, instanceId, {
        ...filtresDe(request.query),
        limite: 50,
        decalage: page * 50,
      });
      return { ...liste, imports: await listerImports(db, instanceId) };
    }),
  );

  app.get<Route>('/api/i/:slug/base/export.csv', async (request, reply) => {
    const instance = await getInstanceBySlug(db, request.params.slug);
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    const csv = await exporterCsv(db, instance.id, filtresDe(request.query));
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="base-vivante.csv"')
      .send(csv);
  });

  app.post<Route>(
    '/api/i/:slug/base/historique/actualiser',
    surInstance((instanceId) => actualiserHistorique(db, instanceId)),
  );

  app.patch<Route>(
    '/api/i/:slug/base/fiches/:id',
    surInstance(async (instanceId, request) => {
      const corps = conformiteSchema.safeParse(request.body);
      if (!corps.success) throw new ImportRefuse('Modification invalide');
      await modifierConformite(db, instanceId, request.params.id as string, corps.data);
      return { ok: true };
    }),
  );

  app.post<Route>(
    '/api/i/:slug/base/imports',
    { bodyLimit: 60_000_000 },
    surInstance(async (instanceId, request) => {
      const corps = creationSchema.safeParse(request.body);
      if (!corps.success)
        throw new ImportRefuse(corps.error.issues[0]?.message ?? 'Identifiant invalide');
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
