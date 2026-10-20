import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { chargerGrille, cleQuestion, GrilleInvalide, LETTRES, type Grille } from './grille.js';
import { diagnosticProjets } from './schema.js';
import { scorer, ScoreIncomplet, type ReponseQuestion } from './score.js';
import { ProjetIntrouvable, verifierEspace, vue, type ProjetVue } from './service.js';

// Entretien : Marc importe le PDF de l'outil externe, Claude en lit les réponses (outil
// enregistrer_reponses_entretien), et l'OS calcule le profil en code avec la grille de scoring.
export const PDF_MAX = 10 * 1024 * 1024;
// Taille du texte base64 d'un PDF de PDF_MAX octets, avec une marge pour le bourrage.
const BASE64_MAX = Math.ceil((PDF_MAX * 4) / 3) + 4;

export function grilleCourante(): Grille {
  const chemin = process.env.DIAGNOSTIC_GRILLE;
  if (!chemin)
    throw new GrilleInvalide("DIAGNOSTIC_GRILLE non défini : l'import du PDF est indisponible.");
  return chargerGrille(chemin);
}

export const reponsesSchema = z
  .array(
    z.object({
      section: z.string().trim().min(1).max(200),
      numero: z.number().int().min(1).max(999),
      reponse: z.enum(LETTRES),
    }),
  )
  .min(1)
  .max(200);

// La grille est lue avant toute écriture : un import refusé ne laisse aucun PDF à moitié enregistré.
export async function importerEntretien(
  db: Executor,
  instance: Instance,
  id: string,
  pdf: { nom: string; base64: string },
): Promise<ProjetVue> {
  verifierEspace(instance);
  if (pdf.base64.length > BASE64_MAX) throw new ChatIndisponible('PDF trop lourd (10 Mo au plus).');
  const octets = Buffer.from(pdf.base64, 'base64');
  if (octets.length > PDF_MAX) throw new ChatIndisponible('PDF trop lourd (10 Mo au plus).');
  if (!octets.subarray(0, 4).equals(Buffer.from('%PDF')))
    throw new ChatIndisponible("Ce fichier n'est pas un PDF.");
  try {
    grilleCourante();
  } catch (erreur) {
    if (erreur instanceof GrilleInvalide) throw new ChatIndisponible(erreur.message);
    throw erreur;
  }
  // Le PDF part avec la demande, dans la même écriture : un import ne remplace jamais un PDF en lecture.
  return envoyerMessage(db, instance, id, 'Lis le PDF de l’entretien et enregistre les réponses.', {
    type: 'entretien',
    etape: 2,
    verifier: () => undefined,
    maj: { pdfEntretien: pdf.base64, pdfEntretienNom: pdf.nom },
  });
}

// Claude rend les réponses lues dans le PDF : elles calculent le profil ; la demande est terminée.
export async function enregistrerReponses(
  tx: Tx,
  id: string,
  reponses: ReponseQuestion[],
): Promise<void> {
  const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (projet.demande !== 'entretien')
    throw new ChatIndisponible("Le pilote n'a pas demandé de lecture du PDF.");
  const { dims } = scorer(reponses, grilleCourante());
  await tx
    .update(diagnosticProjets)
    .set({ reponsesEntretien: reponses, dims, demande: null, updatedAt: new Date() })
    .where(eq(diagnosticProjets.id, id));
}

// Correction par le pilote : le profil se recalcule, et l'ancienne valeur reste dans l'historique.
export function corrigerReponse(
  db: Executor,
  instance: Instance,
  id: string,
  question: { section: string; numero: number },
  reponse: ReponseQuestion['reponse'],
): Promise<ProjetVue> {
  verifierEspace(instance);
  return withInstance(db, instance.id, async (tx) => {
    const [projet] = await tx
      .select()
      .from(diagnosticProjets)
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)));
    if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
    if (projet.reponsesEntretien.length === 0)
      throw new ChatIndisponible("Aucune réponse d'entretien à corriger pour ce projet.");
    const cle = cleQuestion(question);
    const index = projet.reponsesEntretien.findIndex((r) => cleQuestion(r) === cle);
    if (index < 0) throw new ChatIndisponible('Question inconnue de ce projet.');
    const ancienne = projet.reponsesEntretien[index]!.reponse;
    const suite = projet.reponsesEntretien.map((r, i) => (i === index ? { ...r, reponse } : r));
    let dims;
    try {
      dims = scorer(suite, grilleCourante()).dims;
    } catch (erreur) {
      if (erreur instanceof ScoreIncomplet) throw new ChatIndisponible(erreur.message);
      throw erreur;
    }
    const [row] = await tx
      .update(diagnosticProjets)
      .set({
        reponsesEntretien: suite,
        dims,
        historiqueReponses: [
          ...projet.historiqueReponses,
          { question: cle, ancienne, nouvelle: reponse, le: new Date().toISOString() },
        ],
        updatedAt: new Date(),
      })
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)))
      .returning();
    return vue(row!);
  });
}
