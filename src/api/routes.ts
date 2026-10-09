import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createContact,
  createEntreprise,
  CrmIndisponible,
  getContact,
  getEntreprise,
  searchContacts,
  searchEntreprises,
} from '../crm/service.js';
import type { Database } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import { instances, type Instance } from '../instances/schema.js';
import { getInstanceBySlug, listInstances } from '../instances/service.js';
import { logEvent, recentEvents } from '../journal/service.js';
import { CHAMPS_EXCLUABLES, OBJETS, reglagesSchema } from '../connecteurs/hubspot/reglages.js';
import { changeOpportunite, ChangementInvalide, getPipeline } from '../crm/pipeline.js';
import { connexions } from '../connexions/schema.js';
import { syncNow } from '../connexions/service.js';
import { BranchementRefuse, brancherHubspot, googleWebFlow } from '../connexions/brancher.js';
import type { FetchLike } from '../connecteurs/google/oauth.js';
import { loadInstanceSecrets } from '../secrets.js';
import { getFavoris, setFavoris } from '../preferences/service.js';
import { getBrief, marquerFait } from '../pilotage/brief.js';
import { deciderProposition, listPropositions, type Filtre } from '../pilotage/validations.js';
import { PropositionRefusee } from '../propositions/service.js';
import { propositions } from '../propositions/schema.js';

// Single user until a second one is decided (question 4 of the implementation plan).
const UTILISATEUR = 'marc';

type SlugParams = { Params: { slug: string } };

const summary = (i: Instance) => ({
  slug: i.slug,
  nom: i.nom,
  sous: i.config.sous ?? '',
  type: i.type,
  couleur: i.config.couleur ?? '#41A594',
  modules: i.config.modules ?? [],
});

const renameSchema = z.object({ nom: z.string().trim().min(1).max(80) });
const texte = z.string().trim().max(200).nullish();
const entrepriseSchema = z.object({
  nom: z.string().trim().min(1).max(200),
  secteur: texte,
  ville: texte,
  taille: z.number().int().min(0).max(1_000_000).nullish(),
  domaine: texte,
});
const contactSchema = z.object({
  nom: z.string().trim().min(1).max(200),
  fonction: texte,
  email: z
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  telephone: texte,
  role: texte,
  entrepriseId: z.uuid().nullish(),
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const favorisSchema = z.object({
  favoris: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,40}$/)).max(30),
});

export type ApiDeps = {
  db: Database;
  secretsDir: string;
  realWrites: boolean;
  googleClient?: { clientId: string; clientSecret: string } | undefined;
  googleFetch?: FetchLike | undefined;
};

export function registerApi(
  app: FastifyInstance,
  { db, secretsDir, realWrites, googleClient, googleFetch }: ApiDeps,
): void {
  const connexionDeps = { secretsDir, realWrites };
  const google = googleWebFlow({
    secretsDir,
    ...(googleClient ? { defaultClient: googleClient } : {}),
    ...(googleFetch ? { fetch: googleFetch } : {}),
  });
  app.get('/api/instances', async () => (await listInstances(db)).map(summary));

  // Every /api/i/:slug/… route: unknown or archived instance → 404, never another instance's data.
  const onInstance =
    <R extends SlugParams>(
      handler: (
        instance: Instance,
        request: FastifyRequest<R>,
        reply: FastifyReply,
      ) => Promise<unknown>,
    ) =>
    async (request: FastifyRequest<R>, reply: FastifyReply) => {
      const { slug } = request.params as SlugParams['Params'];
      const instance = await getInstanceBySlug(db, slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      return handler(instance, request, reply);
    };

  type Search = SlugParams & { Querystring: { q?: string } };
  app.get<Search>(
    '/api/i/:slug/entreprises',
    onInstance<Search>((i, r) => searchEntreprises(db, i.id, r.query.q ?? '')),
  );
  app.get<Search>(
    '/api/i/:slug/contacts',
    onInstance<Search>((i, r) => searchContacts(db, i.id, r.query.q ?? '')),
  );

  type ById = { Params: { slug: string; id: string } };
  const byId = (load: (instanceId: string, id: string) => Promise<unknown>) =>
    onInstance<ById>(async (i, request, reply) => {
      const { id } = request.params;
      const found = UUID.test(id) ? await load(i.id, id) : null;
      return found ?? reply.code(404).send({ error: 'Fiche introuvable dans cette instance' });
    });
  app.get<ById>(
    '/api/i/:slug/entreprises/:id',
    byId((i, id) => getEntreprise(db, i, id)),
  );
  app.get<ById>(
    '/api/i/:slug/contacts/:id',
    byId((i, id) => getContact(db, i, id)),
  );

  type Create = SlugParams & { Body: unknown };
  const creation = <S extends z.ZodType>(
    schema: S,
    create: (instance: Instance, input: z.infer<S>) => Promise<unknown>,
  ) =>
    onInstance<Create>(async (i, request, reply) => {
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Champs invalides' });
      try {
        const created = await create(i, parsed.data);
        const simulated =
          typeof created === 'object' && created !== null && 'simulation' in created;
        return reply.code(simulated ? 202 : 201).send(created);
      } catch (error) {
        if (error instanceof CrmIndisponible) return reply.code(409).send({ error: error.message });
        throw error;
      }
    });
  app.post<Create>(
    '/api/i/:slug/entreprises',
    creation(entrepriseSchema, (i, input) => createEntreprise(db, i, input, connexionDeps)),
  );
  app.post<Create>(
    '/api/i/:slug/contacts',
    creation(contactSchema, (i, input) => createContact(db, i, input, connexionDeps)),
  );

  app.get<SlugParams>(
    '/api/i/:slug/brief',
    onInstance((i) => getBrief(db, i, connexionDeps)),
  );

  type TacheRoute = ById;
  app.post<TacheRoute>(
    '/api/i/:slug/taches/:id/fait',
    onInstance<TacheRoute>(async (i, request, reply) => {
      if (!UUID.test(request.params.id))
        return reply.code(404).send({ error: 'Tâche introuvable' });
      try {
        const done = await marquerFait(db, i, request.params.id, connexionDeps);
        return done ?? reply.code(404).send({ error: 'Tâche introuvable dans cette instance' });
      } catch (error) {
        if (error instanceof CrmIndisponible) return reply.code(409).send({ error: error.message });
        throw error;
      }
    }),
  );

  const FILTRES = ['tout', 'brouillon', 'tache', 'cerveau', 'traites'];
  type ListeRoute = SlugParams & { Querystring: { filtre?: string } };
  app.get<ListeRoute>(
    '/api/i/:slug/propositions',
    onInstance<ListeRoute>((i, request) => {
      const filtre = FILTRES.includes(request.query.filtre ?? '') ? request.query.filtre : 'tout';
      return listPropositions(db, i, filtre as Filtre);
    }),
  );

  const decisionSchema = z
    .object({ decision: z.enum(['valider', 'ecarter']), contenu: z.unknown().optional() })
    .strict();
  type DecisionRoute = ById & { Body: unknown };
  app.post<DecisionRoute>(
    '/api/i/:slug/propositions/:id/decision',
    onInstance<DecisionRoute>(async (i, request, reply) => {
      const parsed = decisionSchema.safeParse(request.body);
      if (!parsed.success || !UUID.test(request.params.id)) {
        return reply.code(400).send({ error: 'Décision invalide' });
      }
      try {
        return await deciderProposition(db, i, request.params.id, parsed.data, connexionDeps);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof PropositionRefusee || /déjà traitée/.test(message)) {
          return reply.code(409).send({ error: message });
        }
        if (/introuvable/.test(message)) return reply.code(404).send({ error: message });
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Contenu invalide' });
        throw error;
      }
    }),
  );

  app.get<SlugParams>(
    '/api/i/:slug/pipeline',
    onInstance((i) => getPipeline(db, i)),
  );

  const changementSchema = z.union([
    z.object({ etape: z.string().min(1).max(100) }).strict(),
    z
      .object({ clos: z.enum(['gagne', 'perdu']), motif: z.string().trim().max(200).nullish() })
      .strict(),
    z.object({ rouvrir: z.literal(true) }).strict(),
  ]);
  type Patch = ById & { Body: unknown };
  app.patch<Patch>(
    '/api/i/:slug/opportunites/:id',
    onInstance<Patch>(async (i, request, reply) => {
      const parsed = changementSchema.safeParse(request.body);
      if (!parsed.success || !UUID.test(request.params.id)) {
        return reply.code(400).send({ error: 'Changement invalide' });
      }
      try {
        const done = await changeOpportunite(db, i, request.params.id, parsed.data, connexionDeps);
        return (
          done ?? reply.code(404).send({ error: 'Opportunité introuvable dans cette instance' })
        );
      } catch (error) {
        if (error instanceof CrmIndisponible) return reply.code(409).send({ error: error.message });
        if (error instanceof ChangementInvalide)
          return reply.code(400).send({ error: error.message });
        throw error;
      }
    }),
  );

  app.get<SlugParams>(
    '/api/i/:slug/journal',
    onInstance((i) => withInstance(db, i.id, (tx) => recentEvents(tx, 200))),
  );

  app.get<SlugParams>(
    '/api/i/:slug/instance',
    onInstance((i) =>
      Promise.resolve({
        ...summary(i),
        statut: i.statut,
        ecrituresReelles: i.config.ecrituresReelles === true,
        creeeLe: i.createdAt,
      }),
    ),
  );

  app.patch<SlugParams & { Body: unknown }>(
    '/api/i/:slug/instance',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = renameSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Nom invalide (1 à 80 caractères)' });
      if (i.type === 'propre') {
        return reply.code(400).send({ error: "Le nom de l'activité propre ne se modifie pas ici" });
      }
      return withInstance(db, i.id, async (tx) => {
        await tx
          .update(instances)
          .set({ nom: parsed.data.nom, updatedAt: new Date() })
          .where(eq(instances.id, i.id));
        await logEvent(tx, {
          acteur: 'pilote',
          action: `Instance renommée : ${i.nom} → ${parsed.data.nom}`,
        });
        return { ...summary(i), nom: parsed.data.nom };
      });
    }),
  );

  // Counters only: no contact, exchange or amount from one instance shows up next to another.
  app.get('/api/portefeuille', async () =>
    Promise.all(
      (await listInstances(db)).map((i) =>
        withInstance(db, i.id, async (tx) => {
          const [aValider] = await tx
            .select({ n: count() })
            .from(propositions)
            .where(
              and(
                eq(propositions.instanceId, currentInstance),
                eq(propositions.statut, 'proposee'),
              ),
            );
          return {
            slug: i.slug,
            nom: i.nom,
            type: i.type,
            aValider: aValider?.n ?? 0,
            // Filled by the lots that bring tasks (M1/M8a), meetings (M8b) and routines (M6).
            tachesEnRetard: null,
            rdv7j: null,
            routinesActives: null,
          };
        }),
      ),
    ),
  );

  // Connection settings for the Paramètres screen. Secret values never leave the server: only
  // whether the expected token is present.
  const SECRET_ATTENDU: Record<string, string> = {
    hubspot: 'HUBSPOT_TOKEN',
    gmail: 'GOOGLE_REFRESH_TOKEN',
    'google-agenda': 'GOOGLE_REFRESH_TOKEN',
  };
  app.get<SlugParams>(
    '/api/i/:slug/connexions',
    onInstance(async (i) => {
      const secrets = await loadInstanceSecrets(secretsDir, i.slug);
      const rows = await withInstance(db, i.id, (tx) =>
        tx.select().from(connexions).where(eq(connexions.instanceId, currentInstance)),
      );
      return {
        connexions: rows.map((c) => ({
          kind: c.kind,
          fournisseur: c.fournisseur,
          etat: c.etat,
          reglages: c.reglages,
          derniereSynchro: c.derniereSynchro,
          derniereErreur: c.derniereErreur,
          secret: SECRET_ATTENDU[c.fournisseur]
            ? {
                nom: SECRET_ATTENDU[c.fournisseur],
                present: !!secrets[SECRET_ATTENDU[c.fournisseur] ?? ''],
              }
            : null,
        })),
        options: { objets: OBJETS, champs: CHAMPS_EXCLUABLES },
        googleClientDisponible: await google.clientDisponible(i.slug),
        ecrituresReelles: realWrites && i.config.ecrituresReelles === true,
      };
    }),
  );

  // Connecting from the screen: the token is checked with HubSpot, saved in the instance's
  // secrets, then a first read-only sync runs in the background.
  const hubspotSchema = z.object({ token: z.string().min(1).max(500) });
  app.post<SlugParams & { Body: unknown }>(
    '/api/i/:slug/connexions/hubspot',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = hubspotSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Jeton manquant' });
      try {
        await brancherHubspot(db, i, parsed.data.token, secretsDir);
      } catch (error) {
        if (error instanceof BranchementRefuse) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
      syncNow(db, i.slug, 'crm', connexionDeps).catch((err: unknown) =>
        request.log.warn({ err }, 'first HubSpot sync failed'),
      );
      return { ok: true };
    }),
  );

  app.post<SlugParams>(
    '/api/i/:slug/connexions/google/start',
    onInstance<SlugParams>(async (i, request, reply) => {
      try {
        const url = await google.start(
          i.slug,
          `${request.protocol}://${request.host}/oauth/google/callback`,
        );
        return { url };
      } catch (error) {
        if (error instanceof BranchementRefuse) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }),
  );

  // Google sends the browser back here after consent; the pilot lands on Paramètres.
  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>(
    '/oauth/google/callback',
    async (request, reply) => {
      try {
        const slug = await google.finish(db, (s) => getInstanceBySlug(db, s), request.query);
        return await reply.redirect(`/#/${slug}/parametres?google=ok`);
      } catch (error) {
        request.log.warn({ err: error }, 'Google consent failed');
        const message =
          error instanceof BranchementRefuse ? error.message : 'Échec de la connexion Google.';
        return reply
          .type('text/html; charset=utf-8')
          .send(
            `<!doctype html><meta charset="utf-8"><p>${message.replace(/[<>&]/g, '')}</p><p><a href="/">Revenir à l'OS</a></p>`,
          );
      }
    },
  );

  const reglagesCrmSchema = reglagesSchema
    .pick({ frequence: true, sens: true, objets: true, champsExclus: true })
    .partial()
    .strict();
  app.patch<SlugParams & { Body: unknown }>(
    '/api/i/:slug/connexions/crm',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = reglagesCrmSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Réglages invalides' });
      return withInstance(db, i.id, async (tx) => {
        const [current] = await tx
          .select()
          .from(connexions)
          .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
        if (!current || current.fournisseur !== 'hubspot') {
          return reply.code(404).send({ error: 'Aucun CRM HubSpot branché sur cette instance' });
        }
        const reglages = { ...current.reglages, ...parsed.data };
        await tx
          .update(connexions)
          .set({ reglages, updatedAt: new Date() })
          .where(eq(connexions.id, current.id));
        const changes = Object.keys(parsed.data).join(', ');
        await logEvent(tx, {
          acteur: 'pilote',
          action: `Réglages du CRM modifiés (${changes})${parsed.data.sens === 'deux_sens' ? ' : écriture dans HubSpot autorisée' : ''}`,
          niveau: 'L2',
        });
        return { reglages };
      });
    }),
  );

  const frequence = z.enum(['5min', '15min', '1h', '1j', 'manuel']);
  const reglagesGoogle = {
    messagerie: z
      .object({
        frequence,
        historiqueMois: z.union([z.literal(3), z.literal(12), z.literal(24)]),
        contenu: z.enum(['extraits', 'complet']),
      })
      .partial()
      .strict(),
    agenda: z
      .object({
        frequence,
        calendriers: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
        tamponMin: z.number().int().min(0).max(120),
      })
      .partial()
      .strict(),
  };
  type KindRoute = { Params: { slug: string; kind: string }; Body: unknown };
  app.patch<KindRoute>(
    '/api/i/:slug/connexions/:kind',
    onInstance<KindRoute>(async (i, request, reply) => {
      const kind = request.params.kind;
      if (kind !== 'messagerie' && kind !== 'agenda') {
        return reply.code(404).send({ error: 'Connexion inconnue' });
      }
      const parsed = reglagesGoogle[kind].safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Réglages invalides' });
      return withInstance(db, i.id, async (tx) => {
        const [current] = await tx
          .select()
          .from(connexions)
          .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, kind)));
        if (!current) return reply.code(404).send({ error: `Aucune ${kind} branchée` });
        const reglages = { ...current.reglages, ...parsed.data };
        await tx
          .update(connexions)
          .set({ reglages, updatedAt: new Date() })
          .where(eq(connexions.id, current.id));
        await logEvent(tx, {
          acteur: 'pilote',
          action: `Réglages ${kind} modifiés (${Object.keys(parsed.data).join(', ')})`,
          niveau: 'L2',
        });
        return { reglages };
      });
    }),
  );

  type SyncRoute = { Params: { slug: string; kind: string } };
  app.post<SyncRoute>(
    '/api/i/:slug/connexions/:kind/sync',
    onInstance<SyncRoute>(async (i, request, reply) => {
      const kind = request.params.kind;
      if (kind !== 'crm' && kind !== 'messagerie' && kind !== 'agenda') {
        return reply.code(404).send({ error: 'Connexion inconnue' });
      }
      try {
        return await syncNow(db, i.slug, kind, connexionDeps);
      } catch (error) {
        return reply
          .code(502)
          .send({ error: error instanceof Error ? error.message : String(error) });
      }
    }),
  );

  app.get('/api/preferences', async () => ({ favoris: await getFavoris(db, UTILISATEUR) }));
  app.put<{ Body: unknown }>('/api/preferences', async (request, reply) => {
    const parsed = favorisSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Favoris invalides' });
    return { favoris: await setFavoris(db, UTILISATEUR, parsed.data.favoris) };
  });
}
