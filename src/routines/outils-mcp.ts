import { and, eq, gte, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { creneauxLibres, zoned, type CreneauxOptions } from '../connecteurs/google/creneaux.js';
import { freeBusy, historique } from '../connecteurs/google/google.js';
import { connexions, type Kind } from '../connexions/schema.js';
import { contacts, entreprises, opportunites, taches } from '../crm/schema.js';
import { currentInstance } from '../db/columns.js';
import { registerTool, type ToolCtx } from '../mcp/tools.js';
import { decaler, jourDe } from '../pilotage/realisees.js';
import '../pilotage/types-propositions.js';
import { propose } from '../propositions/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import { paramsOf, ROUTINES, rythme } from './params.js';
import { cleOf, getRoutine, noterEtape, RoutineArretee, terminerExecution } from './service.js';

// Tools the Claude skills use during a routine run. They only see the token's instance, and a
// tool that needs a connection the instance does not have stops the run.

const FUSEAU = 'Europe/Paris';
const NOMS: Record<Kind, string> = { crm: 'CRM', messagerie: 'Messagerie', agenda: 'Agenda' };
const FOURNISSEUR: Partial<Record<Kind, string>> = {
  messagerie: 'gmail',
  agenda: 'google-agenda',
};
const execution = z.uuid().optional().describe("Identifiant de l'exécution de routine en cours");

async function connexion(ctx: ToolCtx, kind: Kind, executionId?: string) {
  const [c] = await ctx.tx
    .select()
    .from(connexions)
    .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, kind)));
  // A demo (prospect) instance runs on fictive tools: empty history, a free agenda.
  const fictif = c?.fournisseur === 'fake' && ctx.instance.type === 'prospect';
  if (!c || c.etat === 'non_configuree' || (c.fournisseur !== FOURNISSEUR[kind] && !fictif)) {
    throw new RoutineArretee(
      `${NOMS[kind]} non configurée pour ${ctx.instance.nom} : la routine s'arrête ici.`,
      executionId ?? null,
    );
  }
  return c;
}

const google = async (ctx: ToolCtx) => ({
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
      etapes: ROUTINES.find((x) => x.cle === cle)?.etapes ?? [],
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
    return historique(await google(ctx), contact.email, {
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
    "Propose un brouillon d'email (HTML, sans signature) pour une tâche ou un contact. Il attend la validation du pilote dans À valider, puis devient un brouillon Gmail : jamais d'envoi.",
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
