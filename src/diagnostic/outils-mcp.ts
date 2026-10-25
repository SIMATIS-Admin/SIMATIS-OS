import { z } from 'zod';
import { registerTool } from '../mcp/tools.js';
import { repondreClaude } from './chat.js';
import { autoriserSiEntretien, enregistrerReponses, reponsesSchema } from './entretien.js';
import { enregistrerRapport } from './rapport.js';
import { contenuRapportSchema } from './rapport-word.js';
import { autoriserSiRestitution, enregistrerRestitution } from './restitution.js';
import { autoriserOutil, enregistrerSupport, LIEN_ARTIFACT } from './support.js';

// Outil du chat de diagnostic : Claude y répond au pilote (un seul appel par message).
registerTool({
  name: 'repondre_diagnostic',
  description:
    "Répond au pilote dans le chat d'un projet de diagnostic : un message en français, vouvoiement, sans rien inventer. Une seule réponse par message.",
  input: z.object({
    projetId: z.uuid(),
    message: z.string().trim().min(1).max(4000),
  }),
  scope: 'instance',
  handler: async ({ tx }, { projetId, message }) => {
    await repondreClaude(tx, projetId, message);
    return { ok: true };
  },
});

// Outil du support d'ouverture : Claude rend le lien du deck du projet, puis son texte final.
registerTool({
  name: 'enregistrer_support',
  description:
    "Enregistre le support d'ouverture d'un projet de diagnostic. Après avoir créé ou adapté le deck : lien seul. Sur demande « support final » seulement, après relecture du deck publié : diapositives (titre, texte affiché, notes d'orateur), dans l'ordre du deck.",
  input: z.object({
    projetId: z.uuid(),
    lien: z.string().regex(LIEN_ARTIFACT, 'Lien d’artifact claude.ai attendu').optional(),
    diapositives: z
      .array(
        z.object({
          titre: z.string().trim().min(1).max(300),
          texte: z.string().max(8000),
          notes: z.string().max(8000),
        }),
      )
      .min(1)
      .max(40)
      .optional(),
  }),
  scope: 'instance',
  handler: async ({ tx }, { projetId, lien, diapositives }) => {
    await enregistrerSupport(tx, projetId, {
      ...(lien ? { lien } : {}),
      ...(diapositives ? { diapositives } : {}),
    });
    return { ok: true };
  },
});

// Répond aux demandes de confirmation de Claude Code pendant le support (personne pour cliquer).
registerTool({
  name: 'autoriser_outil',
  description:
    "Réservé au runner : décide des demandes de confirmation pendant le support d'ouverture. N'appelle jamais cet outil toi-même.",
  input: z.object({
    tool_name: z.string(),
    input: z.record(z.string(), z.unknown()),
    tool_use_id: z.string().optional(),
  }),
  scope: 'instance',
  handler: async ({ tx }, { tool_name, input }) =>
    (await autoriserSiRestitution(tx, tool_name, input)) ??
    (await autoriserSiEntretien(tx, tool_name, input)) ??
    autoriserOutil(tx, tool_name, input),
});

// Outil du rapport : Claude rend le texte du rapport, structuré ; l'OS le met en page en Word.
registerTool({
  name: 'enregistrer_rapport',
  description:
    "Enregistre le rapport rédigé d'un projet de diagnostic : son contenu structuré (essentiel, contexte, résultats, préconisations, plan d'action, conclusion). L'OS le met en page en fichier Word, sans que tu aies à produire de fichier.",
  input: z.object({
    projetId: z.uuid(),
    contenu: contenuRapportSchema,
  }),
  scope: 'instance',
  handler: async ({ tx }, { projetId, contenu }) => {
    await enregistrerRapport(tx, projetId, contenu);
    return { ok: true };
  },
});

// Outil de la restitution : Claude rend le lien du deck créé pour présenter le rapport.
registerTool({
  name: 'enregistrer_restitution',
  description:
    "Enregistre le deck de restitution d'un projet de diagnostic : le lien claude.ai de l'artifact, dès sa création puis une fois publié et relu.",
  input: z.object({
    projetId: z.uuid(),
    lien: z.string().regex(LIEN_ARTIFACT, 'Lien d’artifact claude.ai attendu'),
  }),
  scope: 'instance',
  handler: async ({ tx }, { projetId, lien }) => {
    await enregistrerRestitution(tx, projetId, lien);
    return { ok: true };
  },
});

// Outil de l'entretien : Claude rend les réponses lues dans le PDF, une par question de la grille.
registerTool({
  name: 'enregistrer_reponses_entretien',
  description:
    "Enregistre les réponses de l'entretien lues dans le PDF de l'outil : une lettre (A à E, ou N/A) par question de la grille, identifiée par sa rubrique (section) et son numéro.",
  input: z.object({
    projetId: z.uuid(),
    reponses: reponsesSchema,
  }),
  scope: 'instance',
  handler: async ({ tx }, { projetId, reponses }) => {
    await enregistrerReponses(tx, projetId, reponses);
    return { ok: true };
  },
});
