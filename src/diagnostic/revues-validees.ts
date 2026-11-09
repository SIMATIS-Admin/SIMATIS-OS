import { eq } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { diagnosticProjets } from './schema.js';

export const REVUES_VALIDEES_MAX = 2;
export const TEXTE_REVUE_MAX = 30_000;

const objet = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const HORIZONS: [string, string][] = [
  ['court', 'Court terme'],
  ['moyen', 'Moyen terme'],
  ['long', 'Long terme'],
];
const CHAMPS_LIBRES: [string, string][] = [
  ['indicateurs', 'Indicateurs de pilotage'],
  ['nonFait', 'Ce que l’entreprise ne fera pas'],
  ['preconisationAutre', 'Préconisation à ajouter'],
];

// Une entrée du formulaire : ce que l'OS proposait, ce que le pilote en a fait, ce qu'il a écrit.
const ligne = (titre: string, e: Record<string, unknown>, propose: string): string =>
  [
    titre,
    propose ? `proposé : ${propose}` : null,
    `choix : ${texte(e.choix) || 'non précisé'}`,
    texte(e.detail) ? `texte du pilote : ${texte(e.detail)}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' — ');

// Résumé lisible d'une revue : de quoi comparer les propositions aux choix du pilote. Les champs
// absents sont omis, jamais écrits « null ».
// `max` : la coupe ne sert qu'aux revues données en modèle ; une revue relue par Claude l'est en entier.
export function resumeRevue(revue: Record<string, unknown>, max = TEXTE_REVUE_MAX): string {
  const lignes: string[] = [];
  const precos = Object.entries(objet(revue.preconisations));
  if (precos.length === 0) lignes.push('(aucune préconisation)');
  for (const [cle, v] of precos) {
    const p = objet(v);
    lignes.push(ligne(`Préconisation ${texte(p.titre) || cle}`, p, texte(p.texte)));
  }
  for (const [horizon, libelle] of HORIZONS) {
    const h = objet(objet(revue.planAction)[horizon]);
    for (const [cle, v] of Object.entries(objet(h.blocs))) {
      const b = objet(v);
      lignes.push(ligne(`${libelle} · ${texte(b.bloc) || cle}`, b, texte(b.texte)));
    }
    if (texte(h.libre)) lignes.push(`${libelle} · commentaire libre : ${texte(h.libre)}`);
  }
  const conclusion = objet(revue.conclusion);
  if (Object.keys(conclusion).length > 0)
    lignes.push(
      ligne(
        'Conclusion et prochaine étape',
        conclusion,
        texte(conclusion.proposition) || texte(conclusion.texte),
      ),
    );
  for (const [champ, titre] of CHAMPS_LIBRES)
    if (texte(revue[champ])) lignes.push(`${titre} : ${texte(revue[champ])}`);
  return lignes.join('\n').slice(0, max);
}

// Les deux dernières revues validées de l'instance, hors projet courant, de la plus récente à la plus
// ancienne. Une revue en brouillon ou absente n'est jamais un modèle. Le nom est neutre.
export async function revuesValideesPour(
  db: Executor,
  instance: Instance,
  projetId: string,
): Promise<{ nom: string; texte: string }[]> {
  const projets = await withInstance(db, instance.id, (tx) =>
    tx
      .select({ id: diagnosticProjets.id, revue: diagnosticProjets.revue })
      .from(diagnosticProjets)
      .where(eq(diagnosticProjets.instanceId, instance.id)),
  );
  return projets
    .filter((p) => p.id !== projetId && p.revue?.statut === 'validée')
    .sort((a, b) => texte(b.revue!.savedAt).localeCompare(texte(a.revue!.savedAt)))
    .slice(0, REVUES_VALIDEES_MAX)
    .map((p, i) => ({ nom: `Revue validée ${i + 1}`, texte: resumeRevue(p.revue!) }));
}
