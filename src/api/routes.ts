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
import { getFavoris, setFavoris } from '../preferences/service.js';
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

export type ApiDeps = { db: Database; secretsDir: string; realWrites: boolean };

export function registerApi(app: FastifyInstance, { db, secretsDir, realWrites }: ApiDeps): void {
  const connexionDeps = { secretsDir, realWrites };
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

  app.get('/api/preferences', async () => ({ favoris: await getFavoris(db, UTILISATEUR) }));
  app.put<{ Body: unknown }>('/api/preferences', async (request, reply) => {
    const parsed = favorisSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Favoris invalides' });
    return { favoris: await setFavoris(db, UTILISATEUR, parsed.data.favoris) };
  });
}
