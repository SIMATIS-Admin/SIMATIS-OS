import { z } from 'zod';

// Un atelier tient dans un seul bloc ; au-delà, le fichier n'est pas une sauvegarde d'atelier.
export const TAILLE_MAX_ETAT = 300_000;

export const etatSchema = z
  .object({ v: z.literal(1), step: z.number().int().min(0).max(5) })
  .passthrough()
  .refine((e) => JSON.stringify(e).length <= TAILLE_MAX_ETAT, 'Atelier trop volumineux');

const titre = z.string().trim().min(1, "Nom de l'atelier requis").max(200);

export const creationSchema = z.object({ entrepriseId: z.uuid(), titre });

// Sauvegarde exportée par la page d'origine : { v: 1, steps_state: <état> }.
export const importSchema = z.object({
  entrepriseId: z.uuid(),
  titre,
  sauvegarde: z.object({ v: z.literal(1), steps_state: etatSchema }),
});

export const patchSchema = z.object({ titre: titre.optional(), etat: etatSchema.optional() });
