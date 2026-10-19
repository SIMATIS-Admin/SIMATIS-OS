import { z } from 'zod';
import { registerTool } from '../mcp/tools.js';
import { repondreClaude } from './chat.js';
import { enregistrerSupport, LIEN_ARTIFACT } from './support.js';

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
