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
import { normaliserDomaine } from '../connecteurs/hubspot/domaines.js';
import {
  CHAMPS_EXCLUABLES,
  OBJETS,
  parseReglages,
  reglagesSchema,
} from '../connecteurs/hubspot/reglages.js';
import { retirerDomainesExclus } from '../connecteurs/hubspot/sync.js';
import { changeOpportunite, ChangementInvalide, getPipeline } from '../crm/pipeline.js';
import { connexions } from '../connexions/schema.js';
import { syncNow } from '../connexions/service.js';
import { BranchementRefuse, brancherHubspot, googleWebFlow } from '../connexions/brancher.js';
import type { FetchLike } from '../connecteurs/google/oauth.js';
import { loadInstanceSecrets } from '../secrets.js';
import { getFavoris, setFavoris } from '../preferences/service.js';
import { getBrief, marquerFait } from '../pilotage/brief.js';
import { createTache, listTaches, updateTache } from '../crm/taches.js';
import { deciderProposition, listPropositions, type Filtre } from '../pilotage/validations.js';
import { PropositionRefusee } from '../propositions/service.js';
import { paramsOf, ROUTINES, rythme } from '../routines/params.js';
import { santeRoutines } from '../routines/sante.js';
import {
  cleOf,
  DejaEnCours,
  demanderExecution,
  dernieresExecutions,
  getExecution,
  listerRoutines,
  modifierRoutine,
  RoutineInconnue,
} from '../routines/service.js';
import {
  DevisRefuse,
  demanderTransmission,
  devisActif,
  lignesSchema,
  listerDevis,
  modifierLignes,
  preparerDevis,
  validerDevis,
} from '../conversion/devis.js';
import {
  compteRenduSchema,
  enregistrerCompteRendu,
  listerRendezVous,
  preparer,
  RdvIndisponible,
} from '../conversion/rdv.js';
import { funnelSchema, simulerFunnel } from '../pilotage/funnel.js';
import { funnelOf, getTableau } from '../pilotage/tableau.js';
import {
  convertirProspect,
  creerProspect,
  ProspectRefuse,
  reinitialiserDemo,
} from '../demo/service.js';
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
  googleFetch?: FetchLike | undefined;
};

export function registerApi(
  app: FastifyInstance,
  { db, secretsDir, realWrites, googleFetch }: ApiDeps,
): void {
  const connexionDeps = { secretsDir, realWrites };
  const google = googleWebFlow({
    secretsDir,
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

  const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const semaineSchema = z.object({ du: jour, au: jour }).refine(({ du, au }) => {
    const jours = (Date.parse(au) - Date.parse(du)) / 86_400_000;
    return jours >= 0 && jours <= 42;
  });
  type SemaineRoute = SlugParams & { Querystring: unknown };
  app.get<SemaineRoute>(
    '/api/i/:slug/taches',
    onInstance<SemaineRoute>(async (i, request, reply) => {
      const parsed = semaineSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Période invalide' });
      return listTaches(db, i, parsed.data, connexionDeps);
    }),
  );

  const titreTache = z.string().trim().min(1).max(300);
  const echeanceTache = z.iso.datetime({ offset: true }).nullable();
  const tacheSchema = z
    .object({
      titre: titreTache,
      notes: z.string().max(5000).nullable().optional(),
      echeance: echeanceTache.optional(),
      contactId: z.uuid().nullable().optional(),
      opportuniteId: z.uuid().nullable().optional(),
      hubspot: z.boolean().optional(),
    })
    .strict();
  const tachePatchSchema = z
    .object({
      titre: titreTache.optional(),
      notes: z.string().max(5000).nullable().optional(),
      echeance: echeanceTache.optional(),
      fait: z.boolean().optional(),
    })
    .strict();
  const tacheErreur = (error: unknown, reply: FastifyReply) => {
    if (error instanceof CrmIndisponible) return reply.code(409).send({ error: error.message });
    throw error;
  };
  app.post<SlugParams & { Body: unknown }>(
    '/api/i/:slug/taches',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = tacheSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Tâche invalide' });
      try {
        return await createTache(db, i, parsed.data, connexionDeps);
      } catch (error) {
        return tacheErreur(error, reply);
      }
    }),
  );
  app.patch<TacheRoute & { Body: unknown }>(
    '/api/i/:slug/taches/:id',
    onInstance<TacheRoute & { Body: unknown }>(async (i, request, reply) => {
      if (!UUID.test(request.params.id))
        return reply.code(404).send({ error: 'Tâche introuvable' });
      const parsed = tachePatchSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Modification invalide' });
      try {
        const done = await updateTache(db, i, request.params.id, parsed.data, connexionDeps);
        return done ?? reply.code(404).send({ error: 'Tâche introuvable dans cette instance' });
      } catch (error) {
        return tacheErreur(error, reply);
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

  app.get<SlugParams>(
    '/api/i/:slug/tableau',
    onInstance((i) => getTableau(db, i)),
  );
  app.patch<SlugParams & { Body: unknown }>(
    '/api/i/:slug/funnel',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = funnelSchema.partial().strict().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Valeurs hors bornes' });
      const funnel = { ...funnelOf(i), ...parsed.data };
      await withInstance(db, i.id, (tx) =>
        tx
          .update(instances)
          .set({ config: { ...i.config, funnel }, updatedAt: new Date() })
          .where(eq(instances.id, i.id)),
      );
      return { funnel, simulation: simulerFunnel(funnel) };
    }),
  );

  // Rendez-vous: the instance's agenda linked to its contacts and deals.
  app.get<SlugParams>(
    '/api/i/:slug/rendez-vous',
    onInstance((i) => listerRendezVous(db, i, connexionDeps)),
  );
  app.get<ById>(
    '/api/i/:slug/opportunites/:id/preparation',
    onInstance<ById>(async (i, request, reply) => {
      if (!UUID.test(request.params.id)) return reply.code(404).send({ error: 'Introuvable' });
      try {
        return await preparer(db, i, request.params.id);
      } catch (error) {
        if (error instanceof RdvIndisponible) return reply.code(404).send({ error: error.message });
        throw error;
      }
    }),
  );
  type CrRoute = { Params: { slug: string; id: string }; Body: unknown };
  app.post<CrRoute>(
    '/api/i/:slug/rendez-vous/:id/compte-rendu',
    onInstance<CrRoute>(async (i, request, reply) => {
      const parsed = compteRenduSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Compte rendu incomplet' });
      try {
        return await enregistrerCompteRendu(
          db,
          i,
          request.params.id.slice(0, 300),
          parsed.data,
          connexionDeps,
        );
      } catch (error) {
        if (error instanceof PropositionRefusee) {
          return reply.code(403).send({ error: error.message });
        }
        throw error;
      }
    }),
  );

  // Devis: SIMATIS's own instance only (module devis); anywhere else the screen does not exist.
  const surDevis = <R extends SlugParams>(
    handler: (i: Instance, request: FastifyRequest<R>) => Promise<unknown>,
  ) =>
    onInstance<R>(async (i, request, reply) => {
      if (!devisActif(i))
        return reply.code(404).send({ error: 'Pas de devis dans cette instance' });
      try {
        return await handler(i, request);
      } catch (error) {
        if (error instanceof DevisRefuse) return reply.code(400).send({ error: error.message });
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Demande invalide' });
        if (error instanceof PropositionRefusee) {
          return reply.code(403).send({ error: error.message });
        }
        throw error;
      }
    });
  type DevisRoute = { Params: { slug: string; id: string }; Body: unknown };
  app.get<SlugParams>(
    '/api/i/:slug/devis',
    surDevis((i) => listerDevis(db, i)),
  );
  app.post<SlugParams & { Body: unknown }>(
    '/api/i/:slug/devis',
    surDevis<SlugParams & { Body: unknown }>((i, request) =>
      preparerDevis(db, i, z.object({ opportuniteId: z.uuid() }).parse(request.body).opportuniteId),
    ),
  );
  app.patch<DevisRoute>(
    '/api/i/:slug/devis/:id',
    surDevis<DevisRoute>((i, request) => {
      const parsed = z.object({ lignes: lignesSchema }).safeParse(request.body);
      if (!parsed.success) throw new DevisRefuse('Lignes invalides');
      return modifierLignes(db, i, request.params.id, parsed.data.lignes);
    }),
  );
  app.post<DevisRoute>(
    '/api/i/:slug/devis/:id/valider',
    surDevis<DevisRoute>((i, request) => validerDevis(db, i, request.params.id)),
  );
  app.post<DevisRoute>(
    '/api/i/:slug/devis/:id/transmettre',
    surDevis<DevisRoute>((i, request) =>
      demanderTransmission(db, { instance: i, ...connexionDeps }, request.params.id),
    ),
  );

  // Routines Claude: settings, on/off, « Lancer maintenant » and step-by-step follow-up.
  type CleRoute = { Params: { slug: string; cle: string }; Body: unknown };
  const surRoutine = <R extends SlugParams>(
    handler: (i: Instance, request: FastifyRequest<R>) => Promise<unknown>,
  ) =>
    onInstance<R>(async (i, request, reply) => {
      try {
        return await handler(i, request);
      } catch (error) {
        if (error instanceof RoutineInconnue) return reply.code(404).send({ error: error.message });
        if (error instanceof DejaEnCours) return reply.code(409).send({ error: error.message });
        if (error instanceof z.ZodError)
          return reply.code(400).send({ error: 'Réglage hors bornes' });
        throw error;
      }
    });
  app.get<SlugParams>(
    '/api/i/:slug/routines',
    surRoutine((i) =>
      withInstance(db, i.id, async (tx) => {
        const rows = await listerRoutines(tx);
        const dernieres = await dernieresExecutions(tx);
        return rows.map((r) => {
          const def = ROUTINES.find((x) => x.cle === r.cle);
          return {
            cle: r.cle,
            nom: def?.nom ?? r.cle,
            etapes: def?.etapes.map((x) => x.texte) ?? [],
            skill: r.skill,
            actif: r.actif,
            params: paramsOf(r.cle, r.params),
            rythme: rythme(r.cle, r.params),
            derniere: dernieres.find((d) => d.cle === r.cle)?.derniere ?? null,
          };
        });
      }),
    ),
  );
  const routineChange = z
    .object({ actif: z.boolean(), params: z.record(z.string(), z.unknown()) })
    .partial()
    .strict();
  app.get<SlugParams>(
    '/api/i/:slug/routines/sante',
    surRoutine((i) => santeRoutines(db, i)),
  );
  app.patch<CleRoute>(
    '/api/i/:slug/routines/:cle',
    surRoutine<CleRoute>((i, request) =>
      withInstance(db, i.id, (tx) =>
        modifierRoutine(tx, cleOf(request.params.cle), routineChange.parse(request.body)),
      ),
    ),
  );
  app.post<CleRoute>(
    '/api/i/:slug/routines/:cle/executions',
    surRoutine<CleRoute>((i, request) =>
      withInstance(db, i.id, (tx) => demanderExecution(tx, cleOf(request.params.cle), 'pilote')),
    ),
  );
  app.get<ById>(
    '/api/i/:slug/executions/:id',
    surRoutine<ById>((i, request) => {
      if (!UUID.test(request.params.id)) throw new RoutineInconnue('Exécution introuvable');
      return withInstance(db, i.id, (tx) => getExecution(tx, request.params.id));
    }),
  );

  // Prospects (demo instances): create, reset to the fictive set, convert into a mandate.
  app.post<{ Body: unknown }>('/api/prospects', async (request, reply) => {
    const parsed = renameSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Nom invalide (1 à 80 caractères)' });
    return summary(await creerProspect(db, parsed.data));
  });
  const prospectAction = (action: (i: Instance, body: unknown) => Promise<unknown>) =>
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      try {
        return await action(i, request.body);
      } catch (error) {
        if (error instanceof ProspectRefuse) return reply.code(409).send({ error: error.message });
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Demande invalide' });
        throw error;
      }
    });
  app.post<SlugParams & { Body: unknown }>(
    '/api/i/:slug/demo/reinitialiser',
    prospectAction(async (i) => {
      await reinitialiserDemo(db, i);
      return { ok: true };
    }),
  );
  const conversionSchema = z.object({ crm: z.enum(['hubspot']).nullable() });
  app.post<SlugParams & { Body: unknown }>(
    '/api/i/:slug/convertir',
    prospectAction(async (i, body) => {
      const { crm } = conversionSchema.parse(body ?? { crm: null });
      return summary(await convertirProspect(db, i, { crm }));
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
            routinesActives: (await listerRoutines(tx)).filter((r) => r.actif).length,
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

  // The OS's Google client secret, pasted once for every instance; never sent back.
  app.put<{ Body: unknown }>('/api/google/secret', async (request, reply) => {
    const parsed = z.object({ secret: z.string().min(1).max(200) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Code secret manquant' });
    try {
      await google.enregistrerSecret(parsed.data.secret);
    } catch (error) {
      if (error instanceof BranchementRefuse) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
    return { ok: true };
  });

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
    .extend({
      domainesExclus: z
        .array(z.string().max(300))
        .max(500)
        .transform((list, ctx) => {
          const domaines = list.map(normaliserDomaine);
          if (domaines.some((d) => d === null)) {
            ctx.addIssue({ code: 'custom', message: 'Domaine invalide' });
            return z.NEVER;
          }
          return [...new Set(domaines as string[])];
        }),
    })
    .partial()
    .strict();
  app.patch<SlugParams & { Body: unknown }>(
    '/api/i/:slug/connexions/crm',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = reglagesCrmSchema.safeParse(request.body);
      if (!parsed.success) {
        const domaine = parsed.error.issues.some((i) => i.message === 'Domaine invalide');
        return reply.code(400).send({
          error: domaine
            ? 'Un domaine de la liste est invalide (exemple attendu : ma-banque.fr).'
            : 'Réglages invalides',
        });
      }
      return withInstance(db, i.id, async (tx) => {
        const [current] = await tx
          .select()
          .from(connexions)
          .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
        if (!current || current.fournisseur !== 'hubspot') {
          return reply.code(404).send({ error: 'Aucun CRM HubSpot branché sur cette instance' });
        }
        const reglages = { ...current.reglages, ...parsed.data };
        const avant = parseReglages(current.reglages).domainesExclus;
        const domaines = parsed.data.domainesExclus;
        // A domain taken off the list: only a full pass brings its records back, since the
        // incremental one reads what changed in HubSpot.
        const rendu = domaines !== undefined && avant.some((d) => !domaines.includes(d));
        await tx
          .update(connexions)
          .set({ reglages, updatedAt: new Date(), ...(rendu ? { derniereSynchro: null } : {}) })
          .where(eq(connexions.id, current.id));
        const retirees = domaines ? await retirerDomainesExclus(tx, domaines) : 0;
        const changes = Object.keys(parsed.data).join(', ');
        await logEvent(tx, {
          acteur: 'pilote',
          action: `Réglages du CRM modifiés (${changes})${parsed.data.sens === 'deux_sens' ? ' : écriture dans HubSpot autorisée' : ''}${retirees > 0 ? ` : ${retirees} fiches retirées de la copie` : ''}`,
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
