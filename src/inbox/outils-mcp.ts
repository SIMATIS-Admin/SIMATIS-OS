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
  rattacher,
  rendezVousExternes,
  type Annuaire,
} from './lecture.js';
import { cleDejaDansUnAutreEspace } from './cle-unique.js';
import { deposerSujet } from './depot.js';
import { evenementsClos, sansRendezVousClos } from './rdv-clos.js';
import { brouillonSchema, repondreClaude } from './echanges.js';
import { preparerCompteRendu } from './compte-rendu-prepare.js';
import { preparerReponse } from './reponse-preparee.js';
import {
  comptesRendusEnAttente,
  deposerReunion,
  enregistrerTranscript,
  reunionsATranscrire,
  TRANSCRIPT_MAX,
} from './reunions.js';
import { marquerNoteCerveau, marquerReporte, sujetsAjoutes, sujetsTraites } from './report.js';

// Tools of the Inbox routine. Like every instance tool, they only see the token's instance.
// « À valider » subjects come from proposals only, and the « os » origin is the OS itself.

const execution = z.uuid().optional().describe("Identifiant de l'exécution de routine en cours");

registerTool({
  name: 'deposer_sujet',
  description:
    "Dépose un sujet important à traiter dans l'Inbox (mail à répondre, devis, diagnostic, compte rendu, brouillon non envoyé, autre). La clé identifie le sujet pour toujours : si elle existe déjà, même traitée, rien n'est créé et la réponse est « existant ». La réponse « ignore » est normale, ce n'est pas une erreur : le rendez-vous a été écarté ou son compte rendu est déjà enregistré dans l'OS, ou un autre espace du pilote (Mon activité ou un mandat) a déjà un sujet pour cette clé. Ne rien déposer d'autre pour lui.",
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
  handler: async ({ tx, instance, deps }, input) => {
    // Un événement d'agenda écarté, ou dont le compte rendu est déjà dans l'OS, n'est plus à faire.
    const evenement = /^agenda:(.+)$/.exec(input.cle)?.[1];
    if (evenement && (await evenementsClos(tx, [evenement])).size > 0)
      return {
        statut: 'ignore' as const,
        raison: 'rendez-vous écarté ou compte rendu déjà enregistré',
      };
    // Même clé déjà vue dans un autre espace du pilote : une seule entrée pour tous.
    if (await cleDejaDansUnAutreEspace(deps.db, instance, 'routine', input.cle))
      return { statut: 'ignore' as const, raison: 'déjà dans l’Inbox d’un autre espace' };
    return deposerSujet(tx, {
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
    });
  },
});

registerTool({
  name: 'preparer_reponse',
  description:
    "Rattache à un mail à répondre déjà déposé la réponse que tu as rédigée, pour que le pilote la relise dans son Cockpit : le texte, l'objet et, si tu as créé le brouillon dans sa messagerie, l'adresse web de ce brouillon. Rien n'est envoyé : le pilote valide dans sa messagerie. La clé est celle du dépôt. « introuvable » est normal : le sujet n'existe pas dans cet espace ou il est déjà traité, ne rien faire de plus.",
  input: z.object({
    cle: z.string().trim().min(1).max(300).describe('La clé donnée à deposer_sujet'),
    objet: z.string().trim().max(300).optional(),
    texte: z.string().trim().min(1).max(10000).describe('Le corps de la réponse, texte brut'),
    lienBrouillon: z
      .string()
      .max(2000)
      .optional()
      .describe('Adresse web (http ou https) du brouillon dans la messagerie'),
    executionId: execution,
  }),
  scope: 'instance',
  handler: ({ tx }, input) =>
    preparerReponse(tx, input.cle, {
      objet: input.objet ?? null,
      texte: input.texte,
      lienBrouillon: input.lienBrouillon ?? null,
    }),
});

registerTool({
  name: 'preparer_compte_rendu',
  description:
    "Rattache à une entrée « compte rendu » le compte rendu de réunion que tu as rédigé d'après la transcription (réunion cochée critique) ou, à défaut, le résumé de Wispr Flow. Il remplit le champ de l'entrée : le pilote le relit, le corrige et l'enregistre lui-même. Rien n'est enregistré sur le rendez-vous par cet outil. « introuvable » est normal (entrée déjà traitée, d'un autre type ou d'un autre espace) : ne rien faire de plus.",
  input: z.object({
    sujetId: z.uuid().describe("L'identifiant de l'entrée « compte rendu »"),
    texte: z.string().trim().min(1).max(10000).describe('Le compte rendu, texte brut'),
    executionId: execution,
  }),
  scope: 'instance',
  handler: ({ tx }, input) => preparerCompteRendu(tx, input.sujetId, input.texte),
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
    "Fils de messagerie reçus d'un contact du CRM de l'instance (ou du domaine d'une de ses entreprises), dont le dernier message n'est pas du pilote et date de plus d'un jour ouvré. Les notifications, newsletters et mails où le pilote n'est qu'en copie sont écartés. Lecture seule.",
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
    // Sans ceux déjà écartés ou documentés dans l'OS : la routine ne les propose plus jamais.
    return sansRendezVousClos(
      ctx.tx,
      rendezVousExternes(
        await evenements(g, debut < plancher ? plancher : debut, maintenant, calendriers),
        domaineDe(await compteAgenda(g)),
        await annuaire(ctx),
        maintenant,
      ),
    );
  },
});

registerTool({
  name: 'deposer_reunion_wispr',
  description:
    "Dépose dans l'Inbox une réunion lue dans Wispr Flow (titre, date, participants, résumé). Une réunion déjà déposée n'est jamais recréée (« existant »). Dans un mandat, une réunion sans aucun participant connu du CRM est ignorée (« ignore ») : ce n'est pas une erreur, la réunion appartient à un autre mandat. Si une entrée « compte rendu » en attente correspond à la même réunion (voir comptes_rendus_en_attente), passe son id en sujetExistantId : la réunion s'y relie au lieu de créer une autre entrée. L'OS relie aussi seul une réunion à l'entrée d'un rendez-vous de même titre et de même heure, même déjà traitée.",
  input: z.object({
    wisprId: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe('Identifiant de la réunion dans Wispr Flow'),
    titre: z.string().trim().min(1).max(300),
    debutAt: z.iso.datetime({ offset: true }),
    participants: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
    resume: z.string().max(5000).optional().describe('Résumé de Wispr Flow, texte brut'),
    contactId: z.uuid().optional(),
    entrepriseId: z.uuid().optional(),
    sujetExistantId: z.uuid().optional(),
    executionId: execution,
  }),
  scope: 'instance',
  handler: async (ctx, input) => {
    // Wispr Flow est le même pour tous les mandats : un mandat ne reçoit que les réunions où
    // figure quelqu'un qu'il connaît ; Mon activité (instance propre) reçoit tout.
    const a = await annuaire(ctx);
    const lien = input.participants.map((p) => rattacher(p.toLowerCase(), a)).find(Boolean) ?? null;
    if (!lien && ctx.instance.type !== 'propre') return { statut: 'ignore' as const };
    return deposerReunion(ctx.tx, {
      wisprId: input.wisprId,
      titre: input.titre,
      debutAt: new Date(input.debutAt),
      participants: input.participants,
      resume: input.resume ?? null,
      contactId: input.contactId ?? lien?.contactId ?? null,
      entrepriseId: input.entrepriseId ?? lien?.entrepriseId ?? null,
      sujetExistantId: input.sujetExistantId ?? null,
    });
  },
});

registerTool({
  name: 'comptes_rendus_en_attente',
  description:
    "Entrées « compte rendu » encore à faire dans l'Inbox et sans réunion reliée. Sert à repérer le doublon d'une réunion Wispr Flow (même personne, même jour). Lecture seule.",
  input: z.object({ executionId: execution }),
  scope: 'instance',
  handler: ({ tx }) => comptesRendusEnAttente(tx),
});

registerTool({
  name: 'reunions_a_transcrire',
  description:
    "Réunions que le pilote a cochées « critique » et dont le transcript complet n'est pas encore conservé. Pour chacune, lis le transcript dans Wispr Flow puis appelle enregistrer_transcript.",
  input: z.object({ executionId: execution }),
  scope: 'instance',
  handler: ({ tx }) => reunionsATranscrire(tx),
});

registerTool({
  name: 'enregistrer_transcript',
  description:
    "Conserve le transcript complet d'une réunion critique. Refusé si la réunion n'est pas cochée « critique ».",
  input: z.object({
    wisprId: z.string().trim().min(1).max(300),
    transcript: z.string().min(1).max(TRANSCRIPT_MAX),
    executionId: execution,
  }),
  scope: 'instance',
  handler: async ({ tx }, { wisprId, transcript }) => {
    await enregistrerTranscript(tx, wisprId, transcript);
    return { statut: 'enregistre' };
  },
});
