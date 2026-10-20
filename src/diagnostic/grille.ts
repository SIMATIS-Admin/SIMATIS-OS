import { readFileSync } from 'node:fs';
import { z } from 'zod';

// Grille de scoring du Diagnostic d'Endurance Commerciale : privée, dans le second cerveau. L'OS la
// lit à partir d'un JSON exporté du classeur (scripts/diagnostic/exporter_grille.py).
export type Dimension = 'outils' | 'strategie' | 'polyvalence';
export const LETTRES = ['A', 'B', 'C', 'D', 'E', 'N/A'] as const;
export type Lettre = (typeof LETTRES)[number];

export type QuestionGrille = {
  section: string;
  numero: number;
  libelle: string;
  dimension: Dimension;
  poids: number;
};
export type Grille = { seuil: number; questions: QuestionGrille[] };

export class GrilleInvalide extends Error {}

const schema = z.object({
  seuil: z.number().positive(),
  questions: z
    .array(
      z.object({
        section: z.string().min(1),
        numero: z.number().int().positive(),
        libelle: z.string().min(1),
        dimension: z.enum(['outils', 'strategie', 'polyvalence']),
        poids: z.number().positive(),
      }),
    )
    .min(1),
});

// Une question est identifiée par sa rubrique et son numéro : les numéros se répètent d'une rubrique à l'autre.
export const cleQuestion = (q: { section: string; numero: number }) => `${q.section}#${q.numero}`;

export function chargerGrille(chemin: string): Grille {
  let brut: unknown;
  try {
    brut = JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    throw new GrilleInvalide(`Grille de scoring illisible : ${chemin}`);
  }
  const resultat = schema.safeParse(brut);
  if (!resultat.success) throw new GrilleInvalide('Grille de scoring mal formée');
  const vues = new Set<string>();
  for (const q of resultat.data.questions) {
    const cle = cleQuestion(q);
    if (vues.has(cle)) throw new GrilleInvalide(`Question en double dans la grille : ${cle}`);
    vues.add(cle);
  }
  return resultat.data;
}
