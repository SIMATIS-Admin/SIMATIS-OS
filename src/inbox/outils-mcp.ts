import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { compteAgenda, evenements } from '../connecteurs/google/google.js';
import { messagerieDe } from '../connecteurs/messagerie.js';
import { contactEmails, contacts, entreprises } from '../crm/schema.js';
import { currentInstance } from '../db/columns.js';
import { registerTool, type ToolCtx } from '../mcp/tools.js';
import { connexion, google } from '../routines/outils-mcp.js';
import {
  brouillonsAnciens,
  domaineDe,
  mailsARepondre,
  rendezVousExternes,
  type Annuaire,
} from './lecture.js';
import { deposerSujet } from './depot.js';
import { brouillonSchema, repondreClaude } from './echanges.js';
import { marquerNoteCerveau, marquerReporte, sujetsAjoutes, sujetsTraites } from './report.js';

// Tools of the Inbox routine. Like every instance tool, they only see the token's instance.
// « À valider » subjects come from proposals only, and the « os » origin is the OS itself.

const execution = z.uuid().optional().describe("Identifiant de l'exécution de routine en cours");

registerTool({
  name: 'deposer_sujet',
  description:
    "Dépose un sujet important à traiter dans l'Inbox (mail à répondre, devis, diagnostic, compte rendu, brouillon non envoyé, autre). La clé identifie le sujet pour toujours : si elle existe déjà, même traitée, rien n'est créé et la réponse est « existant ».",
  input: z.object({
    type: z.enum([
      'mail_a_repondre',
      'devis',
      'diagnostic',
      'compte_rendu',
      'brouillon_non_envoye',
      'autre',
    ]),
    titre: z.string().trim().min(1).max(300),
    resume: z.string().max(5000).optional().describe('Quelques lignes, texte brut'),
    origine: z.enum(['messagerie', 'agenda', 'cerveau']),
    cle: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe(
        'Clé stable : identifiant du fil de messagerie, chemin de la fiche suivi d’un repère…',
      ),
    lien: z.string().max(2000).optional().describe('Adresse web (http ou https) de la source'),
    echeance: z.iso.datetime({ offset: true }).optional(),
    contactId: z.uuid().optional(),
    entrepriseId: z.uuid().optional(),
    executionId: execution,
  }),
  scope: 'instance',
  handler: ({ tx }, input) =>
    deposerSujet(tx, {
      type: input.type,
      titre: input.titre,
      resume: input.resume ?? null,
      origine: input.origine,
      source: 'routine',
      sourceId: input.cle,
      lien: input.lien ?? null,
      echeance: input.echeance ? new Date(input.echeance) : null,
      contactId: input.contactId ?? null,
      entrepriseId: input.entrepriseId ?? null,
    }),
});

registerTool({
  name: 'sujets_traites',
  description:
    "Sujets de l'Inbox traités par le pilote (transformés en tâche ou cochés) et pas encore reportés dans le second cerveau. Pour une note du second cerveau validée, donne son contenu à exporter dans l'inbox du second cerveau ; une note écartée est seulement signalée comme traitée.",
  input: z.object({ executionId: execution }),
  scope: 'instance',
  handler: ({ tx }) => sujetsTraites(tx),
});

registerTool({
  name: 'marquer_reporte',
  description:
    'Marque comme reportés les sujets dont la routine a noté le traitement (ou exporté la note) dans le second cerveau. À appeler après le report, jamais avant.',
  input: z.object({ ids: z.array(z.uuid()).min(1).max(200), executionId: execution }),
  scope: 'instance',
  handler: async ({ tx }, { ids }) => ({ reportes: await marquerReporte(tx, ids) }),
});

registerTool({
  name: 'sujets_ajoutes',
  description:
    "Entrées ajoutées à la main par le pilote dans l'Inbox et pas encore notées dans le second cerveau. À noter dans l'inbox du second cerveau (titre, résumé, échéance), puis à marquer avec marquer_note_cerveau.",
  input: z.object({ executionId: execution }),
  scope: 'instance',
  handler: ({ tx }) => sujetsAjoutes(tx),
});

registerTool({
  name: 'marquer_note_cerveau',
  description:
    "Marque comme notées dans le second cerveau les entrées ajoutées à la main dont la routine a écrit la note. À appeler après l'écriture, jamais avant.",
  input: z.object({ ids: z.array(z.uuid()).min(1).max(200), executionId: execution }),
  scope: 'instance',
  handler: async ({ tx }, { ids }) => ({ notes: await marquerNoteCerveau(tx, ids) }),
});

registerTool({
  name: 'repondre_ajout',
  description:
    "Répond au pilote dans un échange d'ajout à l'Inbox : un message court (question s'il manque une information essentielle, sinon confirmation de ce qui a été compris) et, dès que possible, l'entrée préparée. Le pilote la relit et l'ajoute lui-même. Une seule réponse par tour.",
  input: z.object({
    echangeId: z.uuid(),
    message: z.string().trim().min(1).max(2000),
    brouillon: brouillonSchema
      .optional()
      .describe("Entrée préparée ; l'échéance au format ISO avec fuseau, à midi heure de Paris"),
  }),
  scope: 'instance',
  handler: async ({ tx }, { echangeId, message, brouillon }) => {
    const e = await repondreClaude(tx, echangeId, { message, brouillon });
    return { statut: e.statut };
  },
});

// The instance's people, to keep only mails and meetings with someone the CRM knows.
async function annuaire(ctx: ToolCtx): Promise<Annuaire> {
  const principaux = await ctx.tx
    .select({ id: contacts.id, email: contacts.email, entrepriseId: contacts.entrepriseId })
    .from(contacts)
    .where(eq(contacts.instanceId, currentInstance));
  // A mail from a secondary address still comes from a known person.
  const secondaires = await ctx.tx
    .select({ id: contactEmails.contactId, email: contactEmails.email })
    .from(contactEmails)
    .where(and(eq(contactEmails.instanceId, currentInstance), eq(contactEmails.principal, false)));
  const entrepriseDe = new Map(principaux.map((c) => [c.id, c.entrepriseId]));
  return {
    contacts: [
      ...principaux,
      ...secondaires.map((c) => ({ ...c, entrepriseId: entrepriseDe.get(c.id) ?? null })),
    ],
    entreprises: await ctx.tx
      .select({ id: entreprises.id, domaine: entreprises.domaine })
      .from(entreprises)
      .where(eq(entreprises.instanceId, currentInstance)),
  };
}

// Read-only tools: a missing connection fails the tool, never the whole run (no executionId).
registerTool({
  name: 'mails_sans_reponse',
  description:
    "Fils de messagerie reçus d'un contact du CRM de l'instance (ou du domaine d'une de ses entreprises), dont le dernier message n'est pas du pilote et date de plus d'un jour ouvré. Lecture seule.",
  input: z.object({ jours: z.number().int().min(1).max(60).default(14) }),
  scope: 'instance',
  handler: async (ctx, { jours }) => {
    const c = await connexion(ctx, 'messagerie');
    if (c.fournisseur === 'fake') return [];
    const m = messagerieDe(c.fournisseur, await google(ctx));
    return mailsARepondre(
      await m.filsRecents(jours),
      await m.compte(),
      await annuaire(ctx),
      new Date(),
      m.lienFil,
    );
  },
});

registerTool({
  name: 'brouillons_en_attente',
  description:
    'Brouillons de messagerie non envoyés, plus anciens que le nombre de jours donné. Lecture seule.',
  input: z.object({ jours: z.number().int().min(1).max(30).default(3) }),
  scope: 'instance',
  handler: async (ctx, { jours }) => {
    const c = await connexion(ctx, 'messagerie');
    if (c.fournisseur === 'fake') return [];
    return brouillonsAnciens(
      await messagerieDe(c.fournisseur, await google(ctx)).brouillons(),
      jours,
      new Date(),
    );
  },
});

registerTool({
  name: 'rendez_vous_passes',
  description:
    "Rendez-vous terminés depuis la date donnée (par défaut trois jours, 31 jours au plus) avec au moins un participant extérieur au domaine du pilote, rattachés au contact ou à l'entreprise du CRM quand c'est possible. Lecture seule.",
  input: z.object({ depuis: z.iso.datetime({ offset: true }).optional() }),
  scope: 'instance',
  handler: async (ctx, { depuis }) => {
    const c = await connexion(ctx, 'agenda');
    if (c.fournisseur === 'fake') return [];
    const maintenant = new Date();
    const plancher = new Date(maintenant.getTime() - 31 * 864e5);
    const debut = depuis ? new Date(depuis) : new Date(maintenant.getTime() - 3 * 864e5);
    const calendriers = Array.isArray(c.reglages.calendriers)
      ? (c.reglages.calendriers as string[])
      : ['primary'];
    const g = await google(ctx);
    return rendezVousExternes(
      await evenements(g, debut < plancher ? plancher : debut, maintenant, calendriers),
      domaineDe(await compteAgenda(g)),
      await annuaire(ctx),
      maintenant,
    );
  },
});
