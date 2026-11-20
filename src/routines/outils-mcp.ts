import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { creneauxLibres, zoned, type CreneauxOptions } from '../connecteurs/google/creneaux.js';
import { freeBusy } from '../connecteurs/google/google.js';
import { MESSAGERIES, messagerieDe } from '../connecteurs/messagerie.js';
import { connexions, type Kind } from '../connexions/schema.js';
import { classementAffaire } from '../crm/echanges.js';
import { INACTIVITE_DEFAUT, rdvDeLAffaire } from '../crm/pipeline.js';
import { contacts, entreprises, opportunites, taches } from '../crm/schema.js';
import { currentInstance } from '../db/columns.js';
import { registerTool, type ToolCtx } from '../mcp/tools.js';
import { decaler, jourDe } from '../pilotage/realisees.js';
import '../pilotage/types-propositions.js';
import '../conversion/types-rdv.js';
import { propositions } from '../propositions/schema.js';
import { propose } from '../propositions/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import { paramsOf, ROUTINES, rythme } from './params.js';
import { cleOf, getRoutine, noterEtape, RoutineArretee, terminerExecution } from './service.js';

// Tools the Claude skills use during a routine run. They only see the token's instance, and a
// tool that needs a connection the instance does not have stops the run.

const FUSEAU = 'Europe/Paris';
const NOMS: Record<Kind, string> = { crm: 'CRM', messagerie: 'Messagerie', agenda: 'Agenda' };
const FOURNISSEURS: Partial<Record<Kind, string[]>> = {
  messagerie: MESSAGERIES,
  agenda: ['google-agenda'],
};
const execution = z.uuid().optional().describe("Identifiant de l'exécution de routine en cours");

// Without an execution id, a missing connection fails this tool only: the run goes on.
export async function connexion(ctx: ToolCtx, kind: Kind, executionId?: string) {
  const [c] = await ctx.tx
    .select()
    .from(connexions)
    .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, kind)));
  // A demo (prospect) instance runs on fictive tools: empty history, a free agenda.
  const fictif = c?.fournisseur === 'fake' && ctx.instance.type === 'prospect';
  if (
    !c ||
    c.etat === 'non_configuree' ||
    (!FOURNISSEURS[kind]?.includes(c.fournisseur) && !fictif)
  ) {
    if (!executionId) throw new Error(`${NOMS[kind]} non configurée pour ${ctx.instance.nom}.`);
    throw new RoutineArretee(
      `${NOMS[kind]} non configurée pour ${ctx.instance.nom} : la routine s'arrête ici.`,
      executionId,
    );
  }
  return c;
}

export const google = async (ctx: ToolCtx) => ({
  instance: ctx.instance,
  secrets: await loadInstanceSecrets(ctx.deps.secretsDir, ctx.instance.slug),
});

const PLAGES: Record<string, [string, string][]> = {
  '9h30-12h00 et 14h00-17h00': [
    ['09:30', '12:00'],
    ['14:00', '17:00'],
  ],
  '9h00-12h00 seulement': [['09:00', '12:00']],
  '14h00-18h00 seulement': [['14:00', '18:00']],
};
const JOURS: Record<string, CreneauxOptions['jours']> = {
  'Jours ouvrés': 'ouvres',
  'Du lundi au jeudi': 'lun-jeu',
  'Tous les jours': 'tous',
};

registerTool({
  name: 'parametres_routine',
  description:
    "Réglages d'une routine (quotidienne, nettoyage, hebdo, evenement) tels que le pilote les a fixés dans Paramètres.",
  input: z.object({ routine: z.string() }),
  scope: 'instance',
  handler: async ({ tx }, { routine }) => {
    const cle = cleOf(routine);
    const r = await getRoutine(tx, cle);
    return {
      routine: cle,
      skill: r.skill,
      actif: r.actif,
      rythme: rythme(cle, r.params),
      params: paramsOf(cle, r.params),
      etapes: ROUTINES.find((x) => x.cle === cle)?.etapes.map((x) => x.texte) ?? [],
    };
  },
});

registerTool({
  name: 'taches_du_jour',
  description:
    "Tâches ouvertes échues ou du jour (heure de Paris), avec le contact, l'entreprise et l'opportunité. Par défaut, les canaux et le retard maximal réglés pour la routine quotidienne.",
  input: z.object({
    canaux: z.array(z.enum(['email', 'appel', 'tache'])).optional(),
    retardMaxJours: z.number().int().min(0).max(90).optional(),
  }),
  scope: 'instance',
  handler: async ({ tx }, input) => {
    const p = paramsOf('quotidienne', (await getRoutine(tx, 'quotidienne')).params);
    const canaux = input.canaux ?? p.canaux;
    const jour = jourDe(new Date(), FUSEAU);
    const rows = await tx
      .select({
        id: taches.id,
        titre: taches.titre,
        canal: taches.canal,
        echeance: taches.echeance,
        prepare: taches.prepare,
        contactId: taches.contactId,
        contact: contacts.nom,
        email: contacts.email,
        entreprise: entreprises.nom,
        opportunite: opportunites.titre,
      })
      .from(taches)
      .leftJoin(
        contacts,
        and(eq(contacts.id, taches.contactId), eq(contacts.instanceId, currentInstance)),
      )
      .leftJoin(
        entreprises,
        and(eq(entreprises.id, contacts.entrepriseId), eq(entreprises.instanceId, currentInstance)),
      )
      .leftJoin(
        opportunites,
        and(
          eq(opportunites.id, taches.opportuniteId),
          eq(opportunites.instanceId, currentInstance),
        ),
      )
      .where(
        and(
          eq(taches.instanceId, currentInstance),
          isNull(taches.faitAt),
          lt(taches.echeance, zoned(decaler(jour, 1), '00:00', FUSEAU)),
          gte(
            taches.echeance,
            zoned(decaler(jour, -(input.retardMaxJours ?? p.retard)), '00:00', FUSEAU),
          ),
        ),
      )
      .orderBy(taches.echeance);
    return rows.filter((t) => (canaux as string[]).includes(t.canal)).slice(0, 200);
  },
});

registerTool({
  name: 'affaires_a_relancer',
  description:
    "Affaires ouvertes à relancer que taches_du_jour ne couvre pas, faute de tâche échue : sans activité depuis le seuil de l'instance (14 jours par défaut), ou rangées au Radar (sans réponse, ou ont répondu). Seules celles dont le contact a une adresse email sont renvoyées, avec son identifiant : à utiliser avec proposer_brouillon (un brouillon à valider, jamais d'envoi).",
  input: z.object({
    joursInactifMin: z.number().int().min(1).max(365).optional(),
    limite: z.number().int().min(1).max(50).default(20),
  }),
  scope: 'instance',
  handler: async ({ tx, instance }, input) => {
    const seuil = input.joursInactifMin ?? instance.config.inactiviteJours ?? INACTIVITE_DEFAUT;
    const depuis = sql`coalesce(${opportunites.derniereActivite}, ${opportunites.createdAt})`;
    const rows = await tx
      .select({
        opportuniteId: opportunites.id,
        titre: opportunites.titre,
        etape: opportunites.etape,
        montant: opportunites.montant,
        entreprise: entreprises.nom,
        contactId: contacts.id,
        contact: contacts.nom,
        email: contacts.email,
        classement: classementAffaire,
        aUnRdv: sql<boolean>`exists (select 1 from rendez_vous r where ${rdvDeLAffaire})`,
        joursInactif: sql<number>`floor(extract(epoch from (now() - ${depuis})) / 86400)::int`,
      })
      .from(opportunites)
      .innerJoin(
        contacts,
        and(eq(contacts.id, opportunites.contactId), eq(contacts.instanceId, currentInstance)),
      )
      .leftJoin(
        entreprises,
        and(
          eq(entreprises.id, opportunites.entrepriseId),
          eq(entreprises.instanceId, currentInstance),
        ),
      )
      .where(
        and(
          eq(opportunites.instanceId, currentInstance),
          isNull(opportunites.clos),
          sql`${contacts.email} is not null and ${contacts.email} <> ''`,
          // Les affaires qui ont une tâche échue sont celles de taches_du_jour.
          sql`not exists (select 1 from taches t where t.instance_id = ${currentInstance}
            and t.fait_at is null and t.echeance < now()
            and (t.opportunite_id = "opportunites"."id"
              or (t.opportunite_id is null and t.contact_id = "opportunites"."contact_id")))`,
          sql`(
            (${classementAffaire} is not null
              and not exists (select 1 from rendez_vous r where ${rdvDeLAffaire}))
            or ${depuis} < now() - make_interval(days => ${seuil})
          )`,
        ),
      )
      .orderBy(sql`${depuis} asc`)
      .limit(input.limite);
    // Une affaire qui a un rendez-vous n'est plus au Radar : elle n'est là que par son inactivité.
    return rows.map(({ classement, aUnRdv, ...r }) => ({
      ...r,
      raison:
        aUnRdv || !classement
          ? 'sans_activite'
          : classement === 'repondu'
            ? 'radar_a_repondu'
            : 'radar_sans_reponse',
    }));
  },
});

registerTool({
  name: 'historique_contact',
  description:
    "Derniers échanges de messagerie avec un contact (extraits, ou corps complet si réglé ainsi). Exige la messagerie de l'instance.",
  input: z.object({ contactId: z.uuid(), executionId: execution }),
  scope: 'instance',
  handler: async (ctx, { contactId, executionId }) => {
    const c = await connexion(ctx, 'messagerie', executionId);
    const [contact] = await ctx.tx
      .select({ email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, contactId)));
    if (!contact?.email || c.fournisseur === 'fake') return [];
    return messagerieDe(c.fournisseur, await google(ctx)).historique(contact.email, {
      mois: typeof c.reglages.historiqueMois === 'number' ? c.reglages.historiqueMois : 12,
      complet: c.reglages.contenu === 'complet',
    });
  },
});

registerTool({
  name: 'creneaux_libres',
  description:
    "Créneaux libres à proposer dans un email, selon les réglages de la routine quotidienne (nombre, délai, plages). Exige l'agenda de l'instance.",
  input: z.object({ executionId: execution }),
  scope: 'instance',
  handler: async (ctx, { executionId }) => {
    const agenda = await connexion(ctx, 'agenda', executionId);
    const p = paramsOf('quotidienne', (await getRoutine(ctx.tx, 'quotidienne')).params);
    const maintenant = new Date();
    const calendriers = Array.isArray(agenda.reglages.calendriers)
      ? (agenda.reglages.calendriers as string[])
      : ['primary'];
    const occupe =
      agenda.fournisseur === 'fake'
        ? []
        : await freeBusy(
            await google(ctx),
            maintenant,
            new Date(maintenant.getTime() + 45 * 864e5),
            calendriers,
          );
    const creneaux = creneauxLibres(
      occupe,
      {
        nombre: p.creneaux,
        delaiJours: p.delai,
        plages: PLAGES[p.plages] ?? [['09:30', '12:00']],
        tamponMin: typeof agenda.reglages.tamponMin === 'number' ? agenda.reglages.tamponMin : 15,
        jours: JOURS[p.jours] ?? 'ouvres',
        fuseau: FUSEAU,
      },
      maintenant,
    );
    return creneaux.map((d) => ({
      debut: d.toISOString(),
      libelle: d.toLocaleString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: FUSEAU,
      }),
    }));
  },
});

registerTool({
  name: 'proposer_brouillon',
  description:
    "Propose un brouillon d'email (HTML, sans signature) pour une tâche ou un contact, au plus un par adresse et par jour (un second est refusé). Il attend la validation du pilote dans l'Inbox, puis devient un brouillon dans la boîte mail de l'instance : jamais d'envoi.",
  input: z.object({
    tacheId: z.uuid().optional(),
    contactId: z.uuid().optional(),
    objet: z.string().min(1).max(300),
    corps: z.string().min(1).max(50_000),
    controles: z.array(z.string().max(500)).max(20).optional(),
    executionId: execution,
  }),
  scope: 'instance',
  handler: async (ctx, input) => {
    await connexion(ctx, 'messagerie', input.executionId);
    let contactId = input.contactId ?? null;
    if (input.tacheId) {
      const [t] = await ctx.tx
        .select({ contactId: taches.contactId })
        .from(taches)
        .where(and(eq(taches.instanceId, currentInstance), eq(taches.id, input.tacheId)));
      contactId = contactId ?? t?.contactId ?? null;
    }
    const [contact] = contactId
      ? await ctx.tx
          .select({ email: contacts.email })
          .from(contacts)
          .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, contactId)))
      : [];
    if (!contact?.email) throw new Error('Contact sans email : brouillon impossible');
    // One mail per person and per day, whatever the number of tasks or runs: matching on the
    // address (not the contact id) also catches two records of the same person.
    const [dejaPropose] = await ctx.tx
      .select({ id: propositions.id })
      .from(propositions)
      .where(
        and(
          eq(propositions.instanceId, currentInstance),
          eq(propositions.type, 'email.brouillon'),
          inArray(propositions.statut, ['proposee', 'appliquee']),
          gte(propositions.createdAt, zoned(jourDe(new Date(), FUSEAU), '00:00', FUSEAU)),
          sql`lower(${propositions.contenu}->>'to') = lower(${contact.email})`,
        ),
      )
      .limit(1);
    if (dejaPropose) {
      throw new Error(
        `Un brouillon pour ${contact.email} existe déjà aujourd’hui : ne pas en proposer un second, le signaler dans le rapport.`,
      );
    }
    return propose(
      ctx.tx,
      { instance: ctx.instance, realWrites: ctx.deps.realWrites, secretsDir: ctx.deps.secretsDir },
      {
        type: 'email.brouillon',
        auteur: ctx.acteur,
        contenu: {
          to: contact.email,
          objet: input.objet,
          corps: input.corps,
          contactId,
          tacheId: input.tacheId ?? null,
          origine: 'Routine Claude',
          controles: input.controles ?? null,
        },
      },
    );
  },
});

registerTool({
  name: 'proposer_tache',
  description:
    'Propose une tâche de suivi (email, appel ou tâche) ; elle attend la validation du pilote selon son niveau d’autonomie.',
  input: z.object({
    titre: z.string().min(1).max(300),
    detail: z.string().max(5000).optional(),
    canal: z.enum(['email', 'appel', 'tache']).default('tache'),
    echeance: z.iso.datetime({ offset: true }).optional(),
    contactId: z.uuid().optional(),
    opportuniteId: z.uuid().optional(),
    executionId: execution,
  }),
  scope: 'instance',
  // executionId is dropped by the task schema (unknown keys are stripped).
  handler: async (ctx, input) =>
    propose(
      ctx.tx,
      { instance: ctx.instance, realWrites: ctx.deps.realWrites, secretsDir: ctx.deps.secretsDir },
      { type: 'crm.tache', auteur: ctx.acteur, contenu: { ...input, origine: 'Routine Claude' } },
    ),
});

registerTool({
  name: 'proposer_rendez_vous',
  description:
    "Propose de créer un rendez-vous (titre, début, durée, lieu, contact) quand une réponse ou un mail accepte un créneau. Il attend la validation du pilote dans le Cockpit : tant qu'il n'a pas validé, rien n'est écrit dans l'OS ni dans l'agenda. La date est celle que le mail confirme, jamais une date devinée.",
  input: z.object({
    titre: z.string().trim().min(1).max(300),
    debut: z.iso.datetime({ offset: true }).describe('Début, avec le fuseau horaire'),
    dureeMinutes: z.number().int().min(5).max(1440).default(60),
    lieu: z.string().trim().max(300).optional(),
    contactId: z.uuid().optional(),
    executionId: execution,
  }),
  scope: 'instance',
  handler: async (ctx, input) =>
    propose(
      ctx.tx,
      { instance: ctx.instance, realWrites: ctx.deps.realWrites, secretsDir: ctx.deps.secretsDir },
      {
        type: 'rdv.creer',
        auteur: ctx.acteur,
        contenu: {
          titre: input.titre,
          debut: new Date(input.debut).toISOString(),
          dureeMinutes: input.dureeMinutes,
          lieu: input.lieu ?? null,
          contactId: input.contactId ?? null,
          origine: 'Routine Claude',
        },
      },
    ),
});

registerTool({
  name: 'etape_routine',
  description: "Signale l'avancement d'une étape de la routine en cours (affiché au pilote).",
  input: z.object({
    executionId: z.uuid(),
    etape: z.string().min(1).max(300),
    statut: z.enum(['en_cours', 'fait', 'echec']),
  }),
  scope: 'instance',
  handler: async ({ tx }, { executionId, etape, statut }) => {
    const e = await noterEtape(tx, executionId, etape, statut);
    return { statut: e.statut, etapes: e.etapes };
  },
});

registerTool({
  name: 'rapport_routine',
  description:
    'Termine la routine en cours avec son rapport : ce qui est fait, ce qui attend le pilote, ce qui a échoué.',
  input: z.object({
    executionId: z.uuid(),
    fait: z.array(z.string().max(500)).max(50),
    attente: z.array(z.string().max(500)).max(50),
    echec: z.array(z.string().max(500)).max(50),
  }),
  scope: 'instance',
  handler: async ({ tx, acteur }, { executionId, ...rapport }) => {
    const e = await terminerExecution(tx, executionId, rapport, acteur);
    return { statut: e.statut };
  },
});
