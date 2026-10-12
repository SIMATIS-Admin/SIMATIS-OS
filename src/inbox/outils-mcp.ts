import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { compteAgenda, evenements } from '../connecteurs/google/google.js';
import { messagerieDe } from '../connecteurs/messagerie.js';
import { contacts, entreprises } from '../crm/schema.js';
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
import { marquerReporte, sujetsTraites } from './report.js';

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

// The instance's people, to keep only mails and meetings with someone the CRM knows.
async function annuaire(ctx: ToolCtx): Promise<Annuaire> {
  return {
    contacts: await ctx.tx
      .select({ id: contacts.id, email: contacts.email, entrepriseId: contacts.entrepriseId })
      .from(contacts)
      .where(eq(contacts.instanceId, currentInstance)),
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
