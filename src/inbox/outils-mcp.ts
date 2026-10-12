import { z } from 'zod';
import { registerTool } from '../mcp/tools.js';
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
