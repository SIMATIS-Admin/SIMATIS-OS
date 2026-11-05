import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../db.js';
import { diagnosticProjets } from './schema.js';
import { ProjetIntrouvable } from './service.js';
import { SupportInvalide } from './support.js';

// Clés courtes des formulaires de revue existants (`r1`, `b3`, `b1l`).
const cle = z.string().regex(/^[a-z0-9]{1,6}$/);
const horizon = z.object({
  dimension: z.string().trim().min(1).max(200),
  blocs: z
    .array(
      z.object({
        cle,
        bloc: z.string().trim().min(1).max(200),
        texte: z.string().trim().min(1).max(4000),
      }),
    )
    .max(8),
});

// Ce que Claude propose pour une revue : des textes seulement. Les choix et les textes du pilote
// ne passent jamais par ici.
export const propositionsRevueSchema = z.object({
  preconisations: z
    .array(
      z.object({
        cle,
        titre: z.string().trim().min(1).max(200),
        texte: z.string().trim().min(1).max(4000),
        bibliotheque: z.string().trim().max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(12),
  planAction: z.strictObject({ court: horizon, moyen: horizon, long: horizon }),
  conclusion: z.object({
    proposition: z.string().trim().min(1).max(4000),
    bibliotheque: z.string().trim().max(100).nullable().optional(),
  }),
});
export type PropositionsRevue = z.infer<typeof propositionsRevueSchema>;

const objet = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const vide = (v: unknown) => (typeof v === 'string' ? v : '');

// Fusionne les propositions de Claude dans la revue : seules les propositions sont remplacées ; tout
// ce que le pilote a choisi ou écrit (choix, detail, libre, entrées ajoutées, champs libres) reste.
// Une revue validée est intouchable : le pilote la rouvre d'abord (elle repasse en brouillon).
export function fusionnerPropositions(
  revue: Record<string, unknown> | null,
  propositions: PropositionsRevue,
  maintenant = new Date(),
): Record<string, unknown> {
  if (revue?.statut === 'validée')
    throw new SupportInvalide('La revue est validée : modifiez-la avant de la préparer.');
  const copie = structuredClone(revue ?? {});
  const preconisations = objet(copie.preconisations);
  for (const p of propositions.preconisations) {
    const existante = objet(preconisations[p.cle]);
    preconisations[p.cle] = {
      ...existante,
      titre: p.titre,
      texte: p.texte,
      bibliotheque: p.bibliotheque ?? null,
      choix: vide(existante.choix),
      detail: vide(existante.detail),
    };
  }
  const planAction = objet(copie.planAction);
  for (const nom of ['court', 'moyen', 'long'] as const) {
    const existant = objet(planAction[nom]);
    const blocs = objet(existant.blocs);
    for (const b of propositions.planAction[nom].blocs) {
      const bloc = objet(blocs[b.cle]);
      blocs[b.cle] = {
        ...bloc,
        bloc: b.bloc,
        texte: b.texte,
        choix: vide(bloc.choix),
        detail: vide(bloc.detail),
      };
    }
    planAction[nom] = {
      ...existant,
      dimension: propositions.planAction[nom].dimension,
      blocs,
      libre: vide(existant.libre),
    };
  }
  const conclusion = objet(copie.conclusion);
  return {
    ...copie,
    statut: 'brouillon',
    savedAt: maintenant.toISOString(),
    preconisations,
    planAction,
    conclusion: {
      ...conclusion,
      proposition: propositions.conclusion.proposition,
      bibliotheque: propositions.conclusion.bibliotheque ?? null,
      choix: vide(conclusion.choix),
      detail: vide(conclusion.detail),
      libre: vide(conclusion.libre),
    },
  };
}

// Claude déclare ses propositions : seule une demande de préparation en cours ouvre l'écriture, et la
// fusion refuse une revue validée. Le statut reste « brouillon » : c'est le pilote qui valide.
export async function enregistrerRevueProposee(
  tx: Tx,
  projetId: string,
  propositions: PropositionsRevue,
): Promise<void> {
  const [projet] = await tx
    .select()
    .from(diagnosticProjets)
    .where(eq(diagnosticProjets.id, projetId));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (projet.demande !== 'revue_preparer')
    throw new SupportInvalide("Le pilote n'a pas demandé de préparation de la revue.");
  const revue = fusionnerPropositions(projet.revue, propositions);
  await tx
    .update(diagnosticProjets)
    .set({ revue, updatedAt: new Date() })
    .where(eq(diagnosticProjets.id, projetId));
}
