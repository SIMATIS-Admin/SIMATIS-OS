import { z } from 'zod';
import { registerTool } from '../mcp/tools.js';
import { repondreClaude } from './chat.js';

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
