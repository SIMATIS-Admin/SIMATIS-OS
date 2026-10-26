import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createProjet,
  deleteProjet,
  DiagnosticIndisponible,
  listProjets,
  ContactIntrouvable,
  EntrepriseIntrouvable,
  ProjetIntrouvable,
  rapportDe,
  updateProjet,
} from '../diagnostic/service.js';
import { creationSchema, projetSchema } from '../diagnostic/saisie.js';
import { ChatIndisponible, envoyerMessage, viderConversation } from '../diagnostic/chat.js';
import { demanderRapport } from '../diagnostic/rapport.js';
import { demanderRestitution } from '../diagnostic/restitution.js';
import { corrigerReponse, importerEntretien } from '../diagnostic/entretien.js';
import { GrilleInvalide, LETTRES } from '../diagnostic/grille.js';
import { demanderSupport, logoDe, rouvrirSupport } from '../diagnostic/support.js';
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
import {
  creerMandatDepuisAffaire,
  lierMandat,
  MandatRefuse,
  mandatLie,
} from '../instances/depuis-affaire.js';
import {
  getInstanceBySlug,
  listInstances,
  PhaseRefusee,
  phaseOf,
  setPhase,
} from '../instances/service.js';
import {
  compterInbox,
  FILTRES_INBOX,
  listInbox,
  marquerTraite,
  remettreATraiter,
  SujetRefuse,
  ajouterSujet,
  modifierSujet,
  transformerEnTache,
  envoyerLivreBlanc,
} from '../inbox/service.js';
import { estNumeroLivreBlanc } from '../inbox/livre-blanc.js';
import { PRIORITE_MAX, PRIORITE_MIN } from '../inbox/schema.js';
import {
  ajouterDepuisEchange,
  annulerEchange,
  EchangeInconnu,
  EchangeRefuse,
  lireEchange,
  ouvrirEchange,
  repondrePilote,
} from '../inbox/echanges.js';
import { lireConsole } from '../console/service.js';
import { logEvent, recentEvents } from '../journal/service.js';
import { normaliserDomaine } from '../connecteurs/hubspot/domaines.js';
import {
  CHAMPS_EXCLUABLES,
  OBJETS,
  parseReglages,
  reglagesSchema,
} from '../connecteurs/hubspot/reglages.js';
import { retirerDomainesExclus } from '../connecteurs/hubspot/sync.js';
import {
  changeOpportunite,
  ChangementInvalide,
  createOpportunite,
  getPipeline,
  rechercherOpportunites,
} from '../crm/pipeline.js';
import { connexions } from '../connexions/schema.js';
import { syncNow } from '../connexions/service.js';
import {
  BranchementRefuse,
  brancherHubspot,
  brancherInfomaniak,
  googleWebFlow,
} from '../connexions/brancher.js';
import type { FetchLike } from '../connecteurs/google/oauth.js';
import { MESSAGERIES, messagerieDe } from '../connecteurs/messagerie.js';
import { loadInstanceSecrets, type CompteImap } from '../secrets.js';
import { siteWebActif, siteWebService, SiteWebIndisponible } from '../site/analytics.js';
import { getFavoris, getOptions, setFavoris, setOptions } from '../preferences/service.js';
import { getBrief, marquerFait } from '../pilotage/brief.js';
import {
  compterAFaire,
  createTache,
  listTaches,
  TacheInvalide,
  updateTache,
} from '../crm/taches.js';
import { TYPES_ACTIVITE } from '../crm/type-tache.js';
import { ajouterEmail, definirEmailPrincipal, retirerEmail } from '../crm/emails.js';
import { fusionnerFiches } from '../crm/fusion.js';
import { definirPrincipal, delierFiches, lierFiches, verifierFiche } from '../crm/liens.js';
import { supprimerFiche } from '../crm/suppression.js';
import {
  ajouterNote,
  FicheInvalide,
  getFiche,
  KINDS,
  updateFiche,
  type Kind,
} from '../crm/fiches.js';
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
  compterATrier,
  decrireRdv,
  enregistrerCompteRendu,
  getRendezVous,
  listerAgendas,
  LienRdvInvalide,
  lierRdv,
  lierRendezVous,
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
  phase: phaseOf(i),
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
// Record a new one is created from (a person or deal added from an organisation's page): the new
// record is linked to it right after its creation.
const lierASchema = z.object({ kind: z.enum(['affaire', 'contact', 'entreprise']), id: z.uuid() });
const avecSchema = z.object({ avec: lierASchema }).strict();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const favorisSchema = z.object({
  favoris: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,40}$/)).max(30),
});

export type ApiDeps = {
  db: Database;
  secretsDir: string;
  realWrites: boolean;
  googleFetch?: FetchLike | undefined;
  // Another IMAP server than Infomaniak's (tests).
  imapServeur?: Pick<CompteImap, 'host' | 'port' | 'secure'> | undefined;
};

export function registerApi(
  app: FastifyInstance,
  { db, secretsDir, realWrites, googleFetch, imapServeur }: ApiDeps,
): void {
  const connexionDeps = { secretsDir, realWrites };
  const google = googleWebFlow({
    secretsDir,
    ...(googleFetch ? { fetch: googleFetch } : {}),
  });
  const siteWeb = siteWebService({
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

  // Creates, then links to the record the form was opened from. The pair is checked first so a
  // refused link never leaves a created record behind.
  const creeEtLie = async <T>(
    kind: Kind,
    lierA: z.infer<typeof lierASchema> | undefined,
    i: Instance,
    creer: () => Promise<T>,
  ): Promise<T> => {
    if (lierA && lierA.kind === kind) throw new FicheInvalide('Lien impossible entre ces fiches');
    if (lierA) await verifierFiche(db, i, lierA);
    const created = await creer();
    const id = (created as { id?: unknown } | null)?.id;
    if (lierA && typeof id === 'string') {
      // The record exists by now: a refused link is reported, never turned into a failed creation
      // (retrying would create a duplicate).
      try {
        await lierFiches(db, i, { kind, id }, lierA, connexionDeps);
      } catch (error) {
        if (!(error instanceof CrmIndisponible || error instanceof FicheInvalide)) throw error;
        return { ...created, avertissement: `Fiche créée, mais non liée : ${error.message}` };
      }
    }
    return created;
  };

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
        if (error instanceof FicheInvalide) return reply.code(400).send({ error: error.message });
        throw error;
      }
    });
  app.post<Create>(
    '/api/i/:slug/entreprises',
    creation(entrepriseSchema.extend({ lierA: lierASchema.optional() }), (i, { lierA, ...input }) =>
      creeEtLie('entreprise', lierA, i, () => createEntreprise(db, i, input, connexionDeps)),
    ),
  );
  app.post<Create>(
    '/api/i/:slug/contacts',
    creation(contactSchema.extend({ lierA: lierASchema.optional() }), (i, { lierA, ...input }) =>
      creeEtLie('contact', lierA, i, () => createContact(db, i, input, connexionDeps)),
    ),
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
  const champsActivite = {
    type: z.enum(TYPES_ACTIVITE).optional(),
    avecHeure: z.boolean().optional(),
    dureeMinutes: z.number().int().min(15).max(480).nullable().optional(),
    occupe: z.boolean().optional(),
  };
  const tacheSchema = z
    .object({
      ...champsActivite,
      titre: titreTache,
      notes: z.string().max(5000).nullable().optional(),
      echeance: echeanceTache.optional(),
      contactId: z.uuid().nullable().optional(),
      entrepriseId: z.uuid().nullable().optional(),
      opportuniteId: z.uuid().nullable().optional(),
      hubspot: z.boolean().optional(),
    })
    .strict();
  const tachePatchSchema = z
    .object({
      ...champsActivite,
      titre: titreTache.optional(),
      notes: z.string().max(5000).nullable().optional(),
      echeance: echeanceTache.optional(),
      fait: z.boolean().optional(),
      contactId: z.uuid().nullable().optional(),
      entrepriseId: z.uuid().nullable().optional(),
    })
    .strict();
  const tacheErreur = (error: unknown, reply: FastifyReply) => {
    if (error instanceof CrmIndisponible) return reply.code(409).send({ error: error.message });
    if (error instanceof TacheInvalide) return reply.code(400).send({ error: error.message });
    throw error;
  };
  // Diagnostic d'Endurance Commerciale : réservé à l'espace SIMATIS (le service refuse les autres).
  type ProjetRoute = { Params: { slug: string; id: string } };
  const diagnosticErreur = (error: unknown, reply: FastifyReply) => {
    if (error instanceof DiagnosticIndisponible)
      return reply.code(403).send({ error: error.message });
    if (error instanceof ProjetIntrouvable) return reply.code(404).send({ error: error.message });
    if (error instanceof EntrepriseIntrouvable || error instanceof ContactIntrouvable)
      return reply.code(400).send({ error: error.message });
    throw error;
  };
  app.get<SlugParams>(
    '/api/i/:slug/diagnostic/projets',
    onInstance(async (i, _request, reply) => {
      try {
        return await listProjets(db, i);
      } catch (error) {
        return diagnosticErreur(error, reply);
      }
    }),
  );
  app.post<SlugParams & { Body: unknown }>(
    '/api/i/:slug/diagnostic/projets',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = creationSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: parsed.error.issues[0]?.message ?? 'Projet invalide' });
      try {
        return await createProjet(db, i, parsed.data);
      } catch (error) {
        return diagnosticErreur(error, reply);
      }
    }),
  );
  app.patch<ProjetRoute & { Body: unknown }>(
    '/api/i/:slug/diagnostic/projets/:id',
    onInstance<ProjetRoute & { Body: unknown }>(async (i, request, reply) => {
      if (!UUID.test(request.params.id)) return reply.code(400).send({ error: 'Projet invalide' });
      const parsed = projetSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: parsed.error.issues[0]?.message ?? 'Projet invalide' });
      try {
        return await updateProjet(db, i, request.params.id, parsed.data);
      } catch (error) {
        return diagnosticErreur(error, reply);
      }
    }),
  );
  app.delete<ProjetRoute>(
    '/api/i/:slug/diagnostic/projets/:id',
    onInstance<ProjetRoute>(async (i, request, reply) => {
      if (!UUID.test(request.params.id)) return reply.code(400).send({ error: 'Projet invalide' });
      try {
        await deleteProjet(db, i, request.params.id);
        return { ok: true };
      } catch (error) {
        return diagnosticErreur(error, reply);
      }
    }),
  );
  // Vider la conversation d'une étape de l'assistant (jamais pendant que Claude répond).
  app.post<ProjetRoute>(
    '/api/i/:slug/diagnostic/projets/:id/messages/vider',
    onInstance<ProjetRoute>(async (i, request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(400).send({ error: 'Projet invalide' });
      const corps = z.object({ etape: z.number().int().min(1).max(5) }).safeParse(request.body);
      if (!corps.success) return reply.code(400).send({ error: 'Étape attendue (1 à 5)' });
      try {
        return await viderConversation(db, i, id, corps.data.etape);
      } catch (error) {
        if (error instanceof ChatIndisponible)
          return reply.code(409).send({ error: error.message });
        return diagnosticErreur(error, reply);
      }
    }),
  );
  // Rapport : le pilote demande sa rédaction par Claude (étape 4, revue validée).
  app.post<ProjetRoute>(
    '/api/i/:slug/diagnostic/projets/:id/rapport/produire',
    onInstance<ProjetRoute>(async (i, request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(400).send({ error: 'Projet invalide' });
      try {
        return await demanderRapport(db, i, id);
      } catch (error) {
        if (error instanceof ChatIndisponible)
          return reply.code(409).send({ error: error.message });
        return diagnosticErreur(error, reply);
      }
    }),
  );
  // Restitution : le pilote demande le deck de présentation du rapport (étape 5).
  app.post<ProjetRoute>(
    '/api/i/:slug/diagnostic/projets/:id/restitution/produire',
    onInstance<ProjetRoute>(async (i, request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(400).send({ error: 'Projet invalide' });
      try {
        return await demanderRestitution(db, i, id);
      } catch (error) {
        if (error instanceof ChatIndisponible)
          return reply.code(409).send({ error: error.message });
        return diagnosticErreur(error, reply);
      }
    }),
  );
  // Entretien : import du PDF de l'outil (PDF de 10 Mo au plus, donc un corps plus grand que la limite
  // par défaut), puis correction d'une réponse lue.
  const corpsPdf = z.object({
    nom: z.string().trim().min(1).max(200),
    base64: z.string().min(1).max(14_000_000),
  });
  const corpsReponse = z.object({
    section: z.string().trim().min(1).max(200),
    numero: z.number().int().min(1).max(999),
    reponse: z.enum(LETTRES),
  });
  const erreurEntretien = (error: unknown, reply: FastifyReply) => {
    if (error instanceof ChatIndisponible) return reply.code(409).send({ error: error.message });
    if (error instanceof GrilleInvalide) return reply.code(400).send({ error: error.message });
    return diagnosticErreur(error, reply);
  };
  app.post<ProjetRoute>(
    '/api/i/:slug/diagnostic/projets/:id/entretien',
    { bodyLimit: 14_000_000 },
    onInstance<ProjetRoute>(async (i, request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(400).send({ error: 'Projet invalide' });
      const corps = corpsPdf.safeParse(request.body);
      if (!corps.success) return reply.code(400).send({ error: 'PDF attendu : nom et contenu' });
      try {
        return await importerEntretien(db, i, id, corps.data);
      } catch (error) {
        return erreurEntretien(error, reply);
      }
    }),
  );
  app.post<ProjetRoute>(
    '/api/i/:slug/diagnostic/projets/:id/entretien/reponse',
    onInstance<ProjetRoute>(async (i, request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(400).send({ error: 'Projet invalide' });
      const corps = corpsReponse.safeParse(request.body);
      if (!corps.success)
        return reply.code(400).send({ error: 'Réponse attendue : section, numéro, lettre' });
      try {
        const { section, numero, reponse } = corps.data;
        return await corrigerReponse(db, i, id, { section, numero }, reponse);
      } catch (error) {
        return erreurEntretien(error, reply);
      }
    }),
  );
  app.get<ProjetRoute & { Querystring: { version?: string } }>(
    '/api/i/:slug/diagnostic/projets/:id/rapport',
    onInstance<ProjetRoute & { Querystring: { version?: string } }>(async (i, request, reply) => {
      if (!UUID.test(request.params.id)) return reply.code(400).send({ error: 'Projet invalide' });
      const version =
        request.query.version === undefined ? undefined : Number(request.query.version);
      if (version !== undefined && !Number.isInteger(version))
        return reply.code(400).send({ error: 'Version invalide' });
      try {
        const { nom, contenu } = await rapportDe(db, i, request.params.id, version);
        reply.header(
          'content-type',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        );
        reply.header('content-disposition', `attachment; filename="${nom.replace(/"/g, '')}"`);
        return reply.send(contenu);
      } catch (error) {
        return diagnosticErreur(error, reply);
      }
    }),
  );
  app.post<ProjetRoute & { Body: unknown }>(
    '/api/i/:slug/diagnostic/projets/:id/messages',
    onInstance<ProjetRoute & { Body: unknown }>(async (i, request, reply) => {
      if (!UUID.test(request.params.id)) return reply.code(400).send({ error: 'Projet invalide' });
      const corps = z.object({ texte: z.string() }).safeParse(request.body);
      if (!corps.success) return reply.code(400).send({ error: 'Message invalide' });
      try {
        return await envoyerMessage(db, i, request.params.id, corps.data.texte);
      } catch (error) {
        if (error instanceof ChatIndisponible)
          return reply.code(409).send({ error: error.message });
        return diagnosticErreur(error, reply);
      }
    }),
  );
  // Support d'ouverture : préparer ou archiver le deck (travail du runner), le rouvrir, son logo.
  app.post<ProjetRoute & { Params: { action: string } }>(
    '/api/i/:slug/diagnostic/projets/:id/support/:action',
    onInstance<ProjetRoute & { Params: { action: string } }>(async (i, request, reply) => {
      const { id, action } = request.params;
      if (!UUID.test(id)) return reply.code(400).send({ error: 'Projet invalide' });
      try {
        if (action === 'preparer') return await demanderSupport(db, i, id, 'preparer_support');
        if (action === 'final') return await demanderSupport(db, i, id, 'support_final');
        if (action === 'rouvrir') return await rouvrirSupport(db, i, id);
        return reply.code(404).send({ error: 'Action inconnue' });
      } catch (error) {
        if (error instanceof ChatIndisponible)
          return reply.code(409).send({ error: error.message });
        return diagnosticErreur(error, reply);
      }
    }),
  );
  app.get<ProjetRoute>(
    '/api/i/:slug/diagnostic/projets/:id/logo',
    onInstance<ProjetRoute>(async (i, request, reply) => {
      if (!UUID.test(request.params.id)) return reply.code(400).send({ error: 'Projet invalide' });
      try {
        const { type, contenu } = await logoDe(db, i, request.params.id);
        reply.header('content-type', type);
        reply.header('x-content-type-options', 'nosniff');
        return reply.send(contenu);
      } catch (error) {
        return diagnosticErreur(error, reply);
      }
    }),
  );
  app.get<SlugParams>(
    '/api/i/:slug/taches/compteur',
    onInstance(async (i) => ({ n: await compterAFaire(db, i) })),
  );
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

  type FicheRoute = { Params: { slug: string; kind: string; id: string }; Body: unknown };
  const ficheParams = (p: FicheRoute['Params']) =>
    KINDS.includes(p.kind as Kind) && UUID.test(p.id) ? (p.kind as Kind) : null;
  const texteCourt = z.string().trim().max(300);
  const patchFicheSchema = z
    .object({
      titre: texteCourt.min(1),
      nom: texteCourt.min(1),
      montant: z.number().int().min(0).nullable(),
      echeance: z.iso.date().nullable(),
      fonction: texteCourt.nullable(),
      email: z.email().nullable(),
      telephone: texteCourt.nullable(),
      ville: texteCourt.nullable(),
      domaine: texteCourt.nullable(),
      secteur: texteCourt.nullable(),
      taille: z.number().int().min(0).nullable(),
      contactId: z.uuid().nullable(),
      entrepriseId: z.uuid().nullable(),
    })
    .partial()
    .strict();
  const noteSchema = z
    .object({ corps: z.string().trim().min(1).max(5000), hubspot: z.boolean().optional() })
    .strict();
  const ficheErreur = (error: unknown, reply: FastifyReply) => {
    if (error instanceof CrmIndisponible) return reply.code(409).send({ error: error.message });
    if (error instanceof FicheInvalide) return reply.code(400).send({ error: error.message });
    throw error;
  };
  app.get<FicheRoute>(
    '/api/i/:slug/fiches/:kind/:id',
    onInstance<FicheRoute>(async (i, request, reply) => {
      const kind = ficheParams(request.params);
      const fiche = kind && (await getFiche(db, i, kind, request.params.id));
      if (!fiche) return reply.code(404).send({ error: 'Fiche introuvable' });
      // A deal of the own activity may have become a mandate (created or linked from it).
      return kind === 'affaire' && i.type === 'propre'
        ? { ...fiche, mandat: await mandatLie(db, request.params.id) }
        : fiche;
    }),
  );
  app.patch<FicheRoute>(
    '/api/i/:slug/fiches/:kind/:id',
    onInstance<FicheRoute>(async (i, request, reply) => {
      const kind = ficheParams(request.params);
      if (!kind) return reply.code(404).send({ error: 'Fiche introuvable' });
      const parsed = patchFicheSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Modification invalide' });
      try {
        const r = await updateFiche(db, i, kind, request.params.id, parsed.data, connexionDeps);
        return r ?? reply.code(404).send({ error: 'Fiche introuvable' });
      } catch (error) {
        return ficheErreur(error, reply);
      }
    }),
  );
  // Links between records, HubSpot-like: add, remove, choose the primary one.
  const surLien = (
    action: (
      i: Instance,
      de: { kind: Kind; id: string },
      avec: z.infer<typeof lierASchema>,
    ) => ReturnType<typeof lierFiches>,
  ) =>
    onInstance<FicheRoute>(async (i, request, reply) => {
      const kind = ficheParams(request.params);
      if (!kind) return reply.code(404).send({ error: 'Fiche introuvable' });
      const parsed = avecSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Lien invalide' });
      try {
        return await action(i, { kind, id: request.params.id }, parsed.data.avec);
      } catch (error) {
        return ficheErreur(error, reply);
      }
    });
  app.post<FicheRoute>(
    '/api/i/:slug/fiches/:kind/:id/liens',
    surLien((i, de, avec) => lierFiches(db, i, de, avec, connexionDeps)),
  );
  app.delete<FicheRoute>(
    '/api/i/:slug/fiches/:kind/:id/liens',
    surLien((i, de, avec) => delierFiches(db, i, de, avec, connexionDeps)),
  );
  app.put<FicheRoute>(
    '/api/i/:slug/fiches/:kind/:id/liens/principal',
    surLien((i, de, avec) => definirPrincipal(db, i, de, avec)),
  );
  // Addresses of a contact: the first one is the primary, which is also written in contacts.email.
  const emailSchema = z.object({ email: z.string().trim().max(300) }).strict();
  const surEmail = (
    action: (i: Instance, contactId: string, email: string) => ReturnType<typeof ajouterEmail>,
  ) =>
    onInstance<FicheRoute>(async (i, request, reply) => {
      if (request.params.kind !== 'contact' || !UUID.test(request.params.id))
        return reply.code(404).send({ error: 'Fiche introuvable' });
      const parsed = emailSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Adresse invalide' });
      try {
        const emails = await action(i, request.params.id, parsed.data.email);
        return emails ? { emails } : reply.code(404).send({ error: 'Fiche introuvable' });
      } catch (error) {
        return ficheErreur(error, reply);
      }
    });
  app.post<FicheRoute>(
    '/api/i/:slug/fiches/:kind/:id/emails',
    surEmail((i, id, email) => ajouterEmail(db, i, id, email)),
  );
  app.delete<FicheRoute>(
    '/api/i/:slug/fiches/:kind/:id/emails',
    surEmail((i, id, email) => retirerEmail(db, i, id, email)),
  );
  app.put<FicheRoute>(
    '/api/i/:slug/fiches/:kind/:id/emails/principal',
    surEmail((i, id, email) => definirEmailPrincipal(db, i, id, email)),
  );
  // Deleting and merging records: HubSpot first when the record lives there (archive / merge), then
  // the OS. Real writes off: simulation, nothing changes.
  const fusionSchema = z.object({ absorbeId: z.uuid() }).strict();
  const lotSchema = z.object({ ids: z.array(z.uuid()).min(1).max(200) }).strict();
  const introuvable = (error: unknown) =>
    error instanceof FicheInvalide && error.message.startsWith('Fiche introuvable');
  app.delete<FicheRoute>(
    '/api/i/:slug/fiches/:kind/:id',
    onInstance<FicheRoute>(async (i, request, reply) => {
      const kind = ficheParams(request.params);
      if (!kind) return reply.code(404).send({ error: 'Fiche introuvable' });
      try {
        return await supprimerFiche(db, i, { kind, id: request.params.id }, connexionDeps);
      } catch (error) {
        if (introuvable(error)) return reply.code(404).send({ error: 'Fiche introuvable' });
        return ficheErreur(error, reply);
      }
    }),
  );
  app.post<FicheRoute>(
    '/api/i/:slug/fiches/:kind/supprimer',
    onInstance<FicheRoute>(async (i, request, reply) => {
      const kind = KINDS.includes(request.params.kind as Kind)
        ? (request.params.kind as Kind)
        : null;
      if (!kind) return reply.code(404).send({ error: 'Fiche introuvable' });
      const parsed = lotSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Sélection invalide' });
      // One by one: a refusal on one record does not stop the others.
      const resultats: { id: string; ok: boolean; simulation?: true; erreur?: string }[] = [];
      for (const id of new Set(parsed.data.ids)) {
        try {
          const r = await supprimerFiche(db, i, { kind, id }, connexionDeps);
          resultats.push(
            'simulation' in r ? { id, ok: false, simulation: true } : { id, ok: true },
          );
        } catch (error) {
          resultats.push({
            id,
            ok: false,
            erreur:
              error instanceof FicheInvalide || error instanceof CrmIndisponible
                ? error.message
                : 'Erreur inattendue',
          });
        }
      }
      return { resultats };
    }),
  );
  app.post<FicheRoute>(
    '/api/i/:slug/fiches/:kind/:id/fusion',
    onInstance<FicheRoute>(async (i, request, reply) => {
      const kind = ficheParams(request.params);
      if (!kind) return reply.code(404).send({ error: 'Fiche introuvable' });
      const parsed = fusionSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Fusion invalide' });
      try {
        return await fusionnerFiches(
          db,
          i,
          kind,
          request.params.id,
          parsed.data.absorbeId,
          connexionDeps,
        );
      } catch (error) {
        return ficheErreur(error, reply);
      }
    }),
  );
  app.post<FicheRoute>(
    '/api/i/:slug/fiches/:kind/:id/notes',
    onInstance<FicheRoute>(async (i, request, reply) => {
      const kind = ficheParams(request.params);
      if (!kind) return reply.code(404).send({ error: 'Fiche introuvable' });
      const parsed = noteSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Note invalide' });
      try {
        const r = await ajouterNote(db, i, kind, request.params.id, parsed.data, connexionDeps);
        return r ?? reply.code(404).send({ error: 'Fiche introuvable' });
      } catch (error) {
        return ficheErreur(error, reply);
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

  type InboxRoute = SlugParams & { Querystring: { filtre?: string } };
  app.get<InboxRoute>(
    '/api/i/:slug/inbox',
    onInstance<InboxRoute>((i, request) => {
      const filtre = FILTRES_INBOX.find((f) => f === request.query.filtre) ?? 'tout';
      return listInbox(db, i, filtre);
    }),
  );
  app.get<SlugParams>(
    '/api/i/:slug/inbox/compteur',
    onInstance(async (i) => ({ n: await compterInbox(db, i) })),
  );

  // Always through the slug of the subject's own instance: the action runs there, never elsewhere.
  type SujetRoute = ById & { Body: unknown };
  const surSujet = (
    action: (
      i: Instance,
      id: string,
      request: FastifyRequest<SujetRoute>,
      reply: FastifyReply,
    ) => Promise<unknown>,
  ) =>
    onInstance<SujetRoute>(async (i, request, reply) => {
      if (!UUID.test(request.params.id))
        return reply.code(404).send({ error: 'Sujet introuvable' });
      try {
        const r = await action(i, request.params.id, request, reply);
        return r ?? reply.code(404).send({ error: 'Sujet introuvable dans cette instance' });
      } catch (error) {
        if (error instanceof SujetRefuse) return reply.code(409).send({ error: error.message });
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Tâche invalide' });
        return tacheErreur(error, reply);
      }
    });
  app.post<SujetRoute>(
    '/api/i/:slug/sujets/:id/traite',
    surSujet((i, id) => marquerTraite(db, i, id)),
  );
  app.post<SujetRoute>(
    '/api/i/:slug/sujets/:id/a-traiter',
    surSujet((i, id) => remettreATraiter(db, i, id)),
  );
  const sujetSaisiSchema = z
    .object({
      titre: z.string().trim().min(1).max(300),
      resume: z.string().trim().max(5000).nullish(),
      echeance: z.iso.datetime({ offset: true }).nullish(),
      priorite: z.number().int().min(PRIORITE_MIN).max(PRIORITE_MAX).optional(),
    })
    .strict();
  app.post<SlugParams & { Body: unknown }>(
    '/api/i/:slug/sujets',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = sujetSaisiSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Titre requis (300 caractères max)' });
      const { titre, resume, echeance, priorite } = parsed.data;
      return reply.code(201).send(
        await ajouterSujet(db, i, {
          titre,
          resume: resume || null,
          echeance: echeance ? new Date(echeance) : null,
          priorite,
        }),
      );
    }),
  );
  // Due date and priority of an existing entry; a missing key is left as it is, null clears a date.
  const sujetModifSchema = z
    .object({
      echeance: z.iso.datetime({ offset: true }).nullish(),
      priorite: z.number().int().min(PRIORITE_MIN).max(PRIORITE_MAX).optional(),
    })
    .strict();
  app.patch<SujetRoute>(
    '/api/i/:slug/sujets/:id',
    surSujet(async (i, id, request, reply) => {
      const parsed = sujetModifSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Échéance ou priorité invalide (priorité de 1 à 5)' });
      const { echeance, priorite } = parsed.data;
      return modifierSujet(db, i, id, {
        ...('echeance' in parsed.data ? { echeance: echeance ? new Date(echeance) : null } : {}),
        ...(priorite !== undefined ? { priorite } : {}),
      });
    }),
  );
  // Add conversation with Claude (answered by the workstation's runner).
  const texteSchema = z.object({ texte: z.string().trim().min(1).max(2000) }).strict();
  type EchangeRoute = ById & { Body: unknown };
  const surEchange = (
    action: (i: Instance, id: string, request: FastifyRequest<EchangeRoute>) => Promise<unknown>,
  ) =>
    onInstance<EchangeRoute>(async (i, request, reply) => {
      if (!UUID.test(request.params.id))
        return reply.code(404).send({ error: 'Échange introuvable' });
      try {
        return await action(i, request.params.id, request);
      } catch (error) {
        if (error instanceof EchangeInconnu) return reply.code(404).send({ error: error.message });
        if (error instanceof EchangeRefuse) return reply.code(409).send({ error: error.message });
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Message vide' });
        throw error;
      }
    });
  app.post<SlugParams & { Body: unknown }>(
    '/api/i/:slug/echanges',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = texteSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Message vide' });
      return reply.code(201).send(await ouvrirEchange(db, i, parsed.data.texte));
    }),
  );
  app.get<EchangeRoute>(
    '/api/i/:slug/echanges/:id',
    surEchange((i, id) => lireEchange(db, i, id)),
  );
  app.post<EchangeRoute>(
    '/api/i/:slug/echanges/:id/messages',
    surEchange((i, id, request) =>
      repondrePilote(db, i, id, texteSchema.parse(request.body).texte),
    ),
  );
  app.post<EchangeRoute>(
    '/api/i/:slug/echanges/:id/ajouter',
    surEchange((i, id) => ajouterDepuisEchange(db, i, id)),
  );
  app.post<EchangeRoute>(
    '/api/i/:slug/echanges/:id/annuler',
    surEchange((i, id) => annulerEchange(db, i, id)),
  );
  // Envoie le livre blanc choisi au demandeur ; 202 quand l'écriture n'est que simulée.
  app.post<SujetRoute>(
    '/api/i/:slug/sujets/:id/livre-blanc',
    surSujet(async (i, id, request, reply) => {
      const numero = (request.body as { numero?: unknown } | null)?.numero;
      if (!estNumeroLivreBlanc(numero))
        return reply.code(400).send({ error: 'Livre blanc inconnu' });
      const r = await envoyerLivreBlanc(db, i, id, numero, connexionDeps);
      return r && 'simulation' in r ? reply.code(202).send(r) : r;
    }),
  );
  const sujetTacheSchema = tacheSchema.omit({ hubspot: true });
  app.post<SujetRoute>(
    '/api/i/:slug/sujets/:id/tache',
    surSujet(async (i, id, request, reply) => {
      const r = await transformerEnTache(
        db,
        i,
        id,
        sujetTacheSchema.parse(request.body),
        connexionDeps,
      );
      return r && 'simulation' in r ? reply.code(202).send(r) : r && reply.code(201).send(r);
    }),
  );

  app.get<SlugParams>(
    '/api/i/:slug/pipeline',
    onInstance((i) => getPipeline(db, i)),
  );

  const reglagesPipelineSchema = z
    .object({ inactiviteJours: z.number().int().min(1).max(90) })
    .strict();
  app.patch<SlugParams & { Body: unknown }>(
    '/api/i/:slug/pipeline/reglages',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = reglagesPipelineSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Nombre de jours invalide (1 à 90)' });
      return withInstance(db, i.id, async (tx) => {
        // Merged into the config: the real-writes lock next to it is never touched here.
        await tx
          .update(instances)
          .set({ config: { ...i.config, ...parsed.data }, updatedAt: new Date() })
          .where(eq(instances.id, i.id));
        await logEvent(tx, {
          acteur: 'pilote',
          action: `Pipeline : opportunité inactive après ${parsed.data.inactiviteJours} jours`,
        });
        return parsed.data;
      });
    }),
  );

  type RechercheRoute = SlugParams & { Querystring: { q?: string } };
  // Global search (Pipedrive top bar): a few deals, people and organisations at once.
  app.get<RechercheRoute>(
    '/api/i/:slug/recherche',
    onInstance<RechercheRoute>(async (i, request) => {
      const q = (request.query.q ?? '').trim().slice(0, 100);
      if (q.length < 2) return { affaires: [], personnes: [], organisations: [] };
      const [affaires, personnes, organisations] = await Promise.all([
        rechercherOpportunites(db, i, q),
        searchContacts(db, i.id, q),
        searchEntreprises(db, i.id, q),
      ]);
      return {
        affaires: affaires.slice(0, 5),
        personnes: personnes
          .slice(0, 5)
          .map((p) => ({ id: p.id, nom: p.nom, entreprise: p.entreprise })),
        organisations: organisations
          .slice(0, 5)
          .map((o) => ({ id: o.id, nom: o.nom, ville: o.ville })),
      };
    }),
  );
  app.get<RechercheRoute>(
    '/api/i/:slug/opportunites/recherche',
    onInstance<RechercheRoute>((i, request) =>
      rechercherOpportunites(db, i, (request.query.q ?? '').slice(0, 100)),
    ),
  );
  const nouvelleOppSchema = z
    .object({
      titre: z.string().trim().min(1).max(300),
      etape: z.string().min(1).max(100),
      montant: z.number().int().min(0).nullable().optional(),
      echeance: z.iso.date().nullable().optional(),
      contactId: z.uuid().nullable().optional(),
      entrepriseId: z.uuid().nullable().optional(),
      lierA: lierASchema.optional(),
    })
    .strict();
  app.post<SlugParams & { Body: unknown }>(
    '/api/i/:slug/opportunites',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = nouvelleOppSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Opportunité invalide' });
      try {
        const { lierA, ...input } = parsed.data;
        return await creeEtLie('affaire', lierA, i, () =>
          createOpportunite(db, i, input, connexionDeps),
        );
      } catch (error) {
        if (error instanceof ChangementInvalide || error instanceof FicheInvalide)
          return reply.code(400).send({ error: error.message });
        if (error instanceof CrmIndisponible) return reply.code(409).send({ error: error.message });
        throw error;
      }
    }),
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
    '/api/i/:slug/console',
    onInstance((i) => withInstance(db, i.id, (tx) => lireConsole(tx))),
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

  const phaseSchema = z.object({ phase: z.enum(['closing', 'en_cours']) });
  app.put<SlugParams & { Body: unknown }>(
    '/api/i/:slug/phase',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = phaseSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Phase invalide' });
      try {
        return summary(await setPhase(db, i.slug, parsed.data.phase));
      } catch (error) {
        if (error instanceof PhaseRefusee) return reply.code(409).send({ error: error.message });
        throw error;
      }
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
  // Every calendar the Google account can see, to choose the ones the agenda reads.
  app.get<SlugParams>(
    '/api/i/:slug/agendas',
    onInstance((i) => listerAgendas(db, i, connexionDeps)),
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
  const lienRdvSchema = z
    .object({ contactId: z.uuid().nullable(), entrepriseId: z.uuid().nullable() })
    .strict();
  app.put<CrRoute>(
    '/api/i/:slug/rendez-vous/:id/lien',
    onInstance<CrRoute>(async (i, request, reply) => {
      const parsed = lienRdvSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Lien invalide' });
      try {
        return await lierRendezVous(db, i, request.params.id.slice(0, 300), parsed.data);
      } catch (error) {
        if (error instanceof LienRdvInvalide) return reply.code(400).send({ error: error.message });
        throw error;
      }
    }),
  );
  app.get<SlugParams>(
    '/api/i/:slug/rendez-vous/compteur',
    onInstance(async (i) => ({ n: await compterATrier(db, i) })),
  );
  // The meeting as a record, sorting it (« Pas un RDV ») and its links to contacts, companies, deals.
  app.get<ById>(
    '/api/i/:slug/rendez-vous/:id',
    onInstance<ById>(async (i, request, reply) => {
      try {
        return await getRendezVous(db, i, request.params.id.slice(0, 300), connexionDeps);
      } catch (error) {
        if (error instanceof RdvIndisponible) return reply.code(404).send({ error: error.message });
        throw error;
      }
    }),
  );
  const statutRdvSchema = z.object({ statut: z.enum(['a_trier', 'rdv', 'ignore']) }).strict();
  app.patch<CrRoute>(
    '/api/i/:slug/rendez-vous/:id',
    onInstance<CrRoute>(async (i, request, reply) => {
      const parsed = statutRdvSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Statut invalide' });
      return decrireRdv(db, i, request.params.id.slice(0, 300), parsed.data.statut);
    }),
  );
  const cibleRdvSchema = z
    .object({ kind: z.enum(['contact', 'entreprise', 'affaire']), id: z.uuid() })
    .strict();
  for (const [method, retirer] of [
    ['POST', false],
    ['DELETE', true],
  ] as const) {
    app.route<CrRoute>({
      method,
      url: '/api/i/:slug/rendez-vous/:id/liens',
      handler: onInstance<CrRoute>(async (i, request, reply) => {
        const parsed = cibleRdvSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Lien invalide' });
        try {
          return await lierRdv(
            db,
            i,
            request.params.id.slice(0, 300),
            parsed.data.kind,
            parsed.data.id,
            retirer,
          );
        } catch (error) {
          if (error instanceof LienRdvInvalide)
            return reply.code(400).send({ error: error.message });
          throw error;
        }
      }),
    });
  }
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

  // Mandate created from (or linked to) a deal of the own activity.
  type AffaireRoute = SlugParams & { Params: { id: string }; Body: unknown };
  const surAffaire = (action: (i: Instance, id: string, body: unknown) => Promise<Instance>) =>
    onInstance<AffaireRoute>(async (i, request, reply) => {
      if (!UUID.test(request.params.id))
        return reply.code(404).send({ error: 'Affaire introuvable' });
      try {
        return summary(await action(i, request.params.id, request.body));
      } catch (error) {
        if (error instanceof MandatRefuse) return reply.code(409).send({ error: error.message });
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Demande invalide' });
        throw error;
      }
    });
  app.post<AffaireRoute>(
    '/api/i/:slug/opportunites/:id/mandat',
    surAffaire((i, id, body) =>
      creerMandatDepuisAffaire(db, i, id, conversionSchema.parse(body ?? { crm: null })),
    ),
  );
  const lierSchema = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/) });
  app.post<AffaireRoute>(
    '/api/i/:slug/opportunites/:id/mandat/lier',
    surAffaire((i, id, body) => lierMandat(db, i, id, lierSchema.parse(body).slug)),
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
            phase: phaseOf(i),
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
    infomaniak: 'IMAP_PASSWORD',
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
                present:
                  !!secrets[SECRET_ATTENDU[c.fournisseur] ?? ''] ||
                  (c.fournisseur === 'hubspot' && !!secrets.HUBSPOT_PERSONAL_KEY),
              }
            : null,
          // HubSpot through the user's personal access key (« Connexion en mode dégradé »).
          degrade:
            c.fournisseur === 'hubspot' && !secrets.HUBSPOT_TOKEN && !!secrets.HUBSPOT_PERSONAL_KEY,
        })),
        options: { objets: OBJETS, champs: CHAMPS_EXCLUABLES },
        googleClientDisponible: await google.clientDisponible(i.slug),
        ecrituresReelles: realWrites && i.config.ecrituresReelles === true,
      };
    }),
  );

  // Connecting from the screen: the token is checked with HubSpot, saved in the instance's
  // secrets, then a first read-only sync runs in the background.
  const hubspotSchema = z.object({
    token: z.string().min(1).max(1500),
    mode: z.enum(['standard', 'degrade']).optional(),
  });
  app.post<SlugParams & { Body: unknown }>(
    '/api/i/:slug/connexions/hubspot',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = hubspotSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Jeton manquant' });
      try {
        await brancherHubspot(db, i, parsed.data.token, secretsDir, parsed.data.mode);
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

  // An Infomaniak mailbox: the address and its device password are checked over IMAP, then
  // saved in the instance's secrets; never sent back.
  const APERCU_JOURS = 14;
  const infomaniakSchema = z.object({
    email: z.string().min(1).max(320),
    motDePasse: z.string().min(1).max(500),
  });
  app.post<SlugParams & { Body: unknown }>(
    '/api/i/:slug/connexions/infomaniak',
    onInstance<SlugParams & { Body: unknown }>(async (i, request, reply) => {
      const parsed = infomaniakSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Adresse ou mot de passe manquant' });
      }
      try {
        await brancherInfomaniak(db, i, parsed.data, secretsDir, imapServeur);
      } catch (error) {
        if (error instanceof BranchementRefuse) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
      return { ok: true };
    }),
  );

  // « Tester la lecture » : reads the mailbox once and shows the pilot what the OS sees. Nothing
  // is stored.
  app.post<SlugParams>(
    '/api/i/:slug/connexions/messagerie/apercu',
    onInstance<SlugParams>(async (i, _request, reply) => {
      const [c] = await withInstance(db, i.id, (tx) =>
        tx
          .select()
          .from(connexions)
          .where(
            and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'messagerie')),
          ),
      );
      if (!c || !MESSAGERIES.includes(c.fournisseur)) {
        return reply.code(400).send({ error: "Aucune boîte mail n'est branchée." });
      }
      const boite = messagerieDe(c.fournisseur, {
        instance: i,
        secrets: await loadInstanceSecrets(secretsDir, i.slug),
      });
      try {
        const fils = await boite.filsRecents(APERCU_JOURS);
        return {
          compte: await boite.compte(),
          jours: APERCU_JOURS,
          fils: fils.length,
          brouillons: (await boite.brouillons()).length,
          derniers: fils.slice(0, 3).map(({ de, objet, date }) => ({ de, objet, date })),
        };
      } catch (error) {
        return reply
          .code(502)
          .send({ error: error instanceof Error ? error.message : String(error) });
      }
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
        const { slug, usage } = await google.finish(
          db,
          (s) => getInstanceBySlug(db, s),
          request.query,
        );
        return await reply.redirect(
          usage === 'analytics' ? `/#/${slug}/siteweb` : `/#/${slug}/parametres?google=ok`,
        );
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

  // Site web: the website's Google Analytics audience, where the site-web module is on.
  const surSiteWeb = <R extends SlugParams>(
    handler: (i: Instance, request: FastifyRequest<R>) => Promise<unknown>,
  ) =>
    onInstance<R>(async (i, request, reply) => {
      if (!siteWebActif(i))
        return reply.code(404).send({ error: 'Pas de section Site web dans cette instance' });
      try {
        return await handler(i, request);
      } catch (error) {
        if (error instanceof SiteWebIndisponible) {
          return reply.code(409).send({ error: error.message });
        }
        if (error instanceof BranchementRefuse) {
          return reply.code(400).send({ error: error.message });
        }
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Demande invalide' });
        throw error;
      }
    });
  app.get<SlugParams>(
    '/api/i/:slug/site-web',
    surSiteWeb((i) => siteWeb.etat(i)),
  );
  app.get<SlugParams>(
    '/api/i/:slug/site-web/proprietes',
    surSiteWeb((i) => siteWeb.proprietes(i)),
  );
  const proprieteSchema = z.object({
    id: z.string().regex(/^\d{1,20}$/),
    nom: z.string().trim().min(1).max(200),
  });
  app.put<SlugParams & { Body: unknown }>(
    '/api/i/:slug/site-web/propriete',
    surSiteWeb<SlugParams & { Body: unknown }>((i, request) =>
      siteWeb.choisirPropriete(db, i, proprieteSchema.parse(request.body)),
    ),
  );
  type RapportRoute = SlugParams & { Querystring: { frais?: string } };
  app.get<RapportRoute>(
    '/api/i/:slug/site-web/rapport',
    surSiteWeb<RapportRoute>((i, request) => siteWeb.rapport(db, i, request.query.frais === '1')),
  );
  app.get<SlugParams>(
    '/api/i/:slug/site-web/temps-reel',
    surSiteWeb((i) => siteWeb.tempsReel(i)),
  );
  app.post<SlugParams>(
    '/api/i/:slug/site-web/google/start',
    surSiteWeb<SlugParams>(async (i, request) => ({
      url: await google.start(
        i.slug,
        `${request.protocol}://${request.host}/oauth/google/callback`,
        'analytics',
      ),
    })),
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

  app.get('/api/preferences', async () => ({
    favoris: await getFavoris(db, UTILISATEUR),
    options: await getOptions(db, UTILISATEUR),
  }));
  const optionsSchema = z.object({ ensuite: z.boolean() }).partial().strict();
  app.put<{ Body: unknown }>('/api/preferences/options', async (request, reply) => {
    const parsed = optionsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Options invalides' });
    return { options: await setOptions(db, UTILISATEUR, parsed.data) };
  });
  app.put<{ Body: unknown }>('/api/preferences', async (request, reply) => {
    const parsed = favorisSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Favoris invalides' });
    return { favoris: await setFavoris(db, UTILISATEUR, parsed.data.favoris) };
  });
}
