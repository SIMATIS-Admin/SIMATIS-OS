import { readFileSync } from 'node:fs';
import { getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import { cleQuestion, type Grille, type Lettre } from './grille.js';
import type { ReponseQuestion } from './score.js';

// Lecture du rapport PDF de l'outil externe, en code et sans Claude : chaque question du tableau
// « Réponses données » porte un pictogramme (✅ A, ❕ B, ❗ C, ❌ D) ; sans pictogramme, la question
// est « non suivie ou non applicable » et sort du calcul. Quand le PDF n'a pas la forme attendue,
// l'appelant retombe sur la lecture par Claude : on ne devine jamais une lettre.
export class LectureImpossible extends Error {}

const PICTOGRAMMES: Record<string, Lettre> = { '✅': 'A', '❕': 'B', '❗': 'C', '❌': 'D' };
const NON_APPLICABLE = /non suivi|non applicable/i;

export type ItemTexte = { page: number; x: number; y: number; texte: string };
export type LigneRapport = { numero: string; question: string; reponse: string; lettre: Lettre };

export async function itemsDuPdf(octets: Uint8Array): Promise<ItemTexte[]> {
  const pdf = await getDocumentProxy(octets);
  const items: ItemTexte[] = [];
  for (let page = 1; page <= pdf.numPages; page++) {
    const contenu = await (await pdf.getPage(page)).getTextContent();
    for (const item of contenu.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const transform = item.transform as number[];
      items.push({ page, x: transform[4]!, y: transform[5]!, texte: item.str.trim() });
    }
  }
  return items;
}

const NUMERO = /^([1-7])\.(\d{1,2})\s/;
// Deux éléments d'une même ligne n'ont pas exactement la même ordonnée.
const TOLERANCE_Y = 3;

// Une ligne par question du tableau : question en colonne de gauche, réponse en colonne « Réponse ».
export function lignesDuRapport(items: ItemTexte[]): LigneRapport[] {
  const debut = items.findIndex((i) => /^RÉPONSES DONNÉES/.test(i.texte));
  if (debut < 0) throw new LectureImpossible('Tableau « Réponses données » introuvable.');
  const tableau = items.slice(debut);
  const entete = tableau.find((i) => i.texte === 'Réponse');
  if (!entete) throw new LectureImpossible('Colonne « Réponse » introuvable.');
  const xReponse = entete.x - 10;

  const departs = tableau.filter((i) => i.x < xReponse && NUMERO.test(i.texte));
  if (departs.length === 0) throw new LectureImpossible('Aucune question dans le tableau.');
  const xQuestion = Math.min(...departs.map((d) => d.x)) - 5;

  const lignes: LigneRapport[] = [];
  const vus = new Set<string>();
  departs.forEach((depart, i) => {
    const [, axe, rang] = NUMERO.exec(depart.texte)!;
    const numero = `${axe}.${rang}`;
    if (vus.has(numero)) throw new LectureImpossible(`Question en double : ${numero}`);
    vus.add(numero);
    const suivant = departs[i + 1];
    const dansLigne = (it: ItemTexte) =>
      it.page === depart.page &&
      it.y <= depart.y + TOLERANCE_Y &&
      (!suivant || suivant.page !== depart.page || it.y > suivant.y + TOLERANCE_Y);
    const ligne = tableau.filter(dansLigne);
    const question = ligne
      .filter((it) => it.x >= xQuestion && it.x < xReponse)
      .map((it) => it.texte)
      .join(' ');
    // Pied de page (adresse, numéro de page) exclu : il tombe sous la dernière ligne d'une page.
    const reponse = ligne
      .filter((it) => it.x >= xReponse && !/^\d+\/\d+$|^https?:/.test(it.texte))
      .map((it) => it.texte)
      .join(' ');
    const picto = Object.keys(PICTOGRAMMES).find((p) => reponse.includes(p));
    if (!picto && !NON_APPLICABLE.test(reponse))
      throw new LectureImpossible(`Réponse non reconnue pour la question ${numero}.`);
    lignes.push({ numero, question, reponse, lettre: picto ? PICTOGRAMMES[picto]! : 'N/A' });
  });
  return lignes;
}

// Correspondance entre la numérotation du rapport et la grille de scoring (privée, comme la
// grille) : le mot-clé vérifie que la question du rapport est bien celle attendue.
export type Correspondance = {
  rapport: string;
  section: string;
  numero: number;
  motCle: string;
}[];

const schemaCorrespondance = z
  .array(
    z.object({
      rapport: z.string().regex(/^[1-7]\.\d{1,2}$/),
      section: z.string().min(1),
      numero: z.number().int().positive(),
      motCle: z.string().min(1),
    }),
  )
  .min(1);

export function chargerCorrespondance(chemin: string): Correspondance {
  let brut: unknown;
  try {
    brut = JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    throw new LectureImpossible(`Correspondance rapport-grille illisible : ${chemin}`);
  }
  const resultat = schemaCorrespondance.safeParse(brut);
  if (!resultat.success) throw new LectureImpossible('Correspondance rapport-grille mal formée');
  return resultat.data;
}

const compacter = (texte: string) =>
  texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function reponsesDuRapport(
  lignes: LigneRapport[],
  correspondance: Correspondance,
  grille: Grille,
): ReponseQuestion[] {
  const parNumero = new Map(lignes.map((l) => [l.numero, l]));
  const reponses = correspondance.map((c) => {
    const ligne = parNumero.get(c.rapport);
    if (!ligne) throw new LectureImpossible(`Question ${c.rapport} absente du rapport.`);
    if (!compacter(ligne.question).includes(compacter(c.motCle)))
      throw new LectureImpossible(`La question ${c.rapport} n'est pas celle attendue.`);
    return { section: c.section, numero: c.numero, reponse: ligne.lettre };
  });
  const attendues = new Set(grille.questions.map(cleQuestion));
  for (const r of reponses)
    if (!attendues.has(cleQuestion(r)))
      throw new LectureImpossible(`Question absente de la grille : ${cleQuestion(r)}`);
  return reponses;
}

export async function lireRapport(
  octets: Uint8Array,
  correspondance: Correspondance,
  grille: Grille,
): Promise<ReponseQuestion[]> {
  let items: ItemTexte[];
  try {
    items = await itemsDuPdf(octets);
  } catch {
    throw new LectureImpossible('PDF illisible.');
  }
  return reponsesDuRapport(lignesDuRapport(items), correspondance, grille);
}
