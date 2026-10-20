import { cleQuestion, LETTRES, type Dimension, type Grille, type Lettre } from './grille.js';
import { profilDe, type Dimensions, type Profil } from './profil.js';

// Calcul en code (jamais par Claude) : une moyenne pondérée par dimension, puis la cascade de profil.
export const NOTES: Record<'A' | 'B' | 'C' | 'D' | 'E', number> = { A: 10, B: 7, C: 4, D: 1, E: 0 };
const DIMENSIONS: Dimension[] = ['outils', 'strategie', 'polyvalence'];

export type ReponseQuestion = { section: string; numero: number; reponse: Lettre };
export class ScoreIncomplet extends Error {}

export function scorer(
  reponses: ReponseQuestion[],
  grille: Grille,
): { dims: Dimensions; profil: Profil } {
  const parCle = new Map<string, ReponseQuestion>();
  for (const r of reponses) {
    if (!(LETTRES as readonly string[]).includes(r.reponse))
      throw new ScoreIncomplet(`Réponse hors de la liste : ${r.reponse}`);
    const cle = cleQuestion(r);
    if (parCle.has(cle)) throw new ScoreIncomplet(`Réponse en double : ${cle}`);
    parCle.set(cle, r);
  }
  const connues = new Set(grille.questions.map(cleQuestion));
  for (const cle of parCle.keys())
    if (!connues.has(cle)) throw new ScoreIncomplet(`Question absente de la grille : ${cle}`);
  const manquantes = grille.questions.filter((q) => !parCle.has(cleQuestion(q)));
  if (manquantes.length > 0)
    throw new ScoreIncomplet(
      `Questions sans réponse : ${manquantes.map((q) => q.libelle).join(', ')}`,
    );

  const dims = {} as Dimensions;
  for (const dimension of DIMENSIONS) {
    let numerateur = 0;
    let denominateur = 0;
    for (const q of grille.questions) {
      if (q.dimension !== dimension) continue;
      const r = parCle.get(cleQuestion(q))!;
      if (r.reponse === 'N/A') continue;
      numerateur += q.poids * NOTES[r.reponse];
      denominateur += q.poids;
    }
    if (denominateur === 0)
      throw new ScoreIncomplet(`Aucune réponse retenue pour la dimension ${dimension}.`);
    dims[dimension] = Math.round((numerateur / denominateur) * 10) / 10;
  }
  return { dims, profil: profilDe(dims) };
}
