import { z } from 'zod';
import { activiteValide } from './activites.js';

// Modèles et efforts proposés pour l'assistant de chaque étape (le chat tourne sur claude.ai).
export const MODELES = ['haiku', 'sonnet', 'opus', 'fable'] as const;
export const EFFORTS = ['faible', 'moyen', 'eleve', 'max'] as const;

const activite = z.string().refine(activiteValide, 'Activité inconnue');
const note = z.number().min(0).max(10);
const lienClaude = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => v === '' || /^https:\/\/claude\.ai\//.test(v),
    'Le lien doit pointer vers claude.ai',
  );

export const creationSchema = z.object({
  nom: z.string().trim().min(1, 'Nom requis').max(200),
  activite,
});

export const projetSchema = z
  .object({
    nom: z.string().trim().min(1).max(200).optional(),
    activite: activite.optional(),
    contexte: z.string().max(5000).optional(),
    etape: z.number().int().min(1).max(3).optional(),
    dims: z.object({ outils: note, strategie: note, polyvalence: note }).nullable().optional(),
    statutDiagnostic: z.enum(['Rapport à rédiger', 'Restitué']).nullable().optional(),
    dateDiagnostic: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    // Formulaire de revue saisi dans l'OS (commentaires, choix par préconisation et par action).
    revue: z.record(z.string(), z.unknown()).nullable().optional(),
    chats: z
      .record(
        z.string().regex(/^[123]$/),
        z.object({
          modele: z.enum(MODELES),
          effort: z.enum(EFFORTS),
          lien: lienClaude,
        }),
      )
      .optional(),
  })
  .strict();
