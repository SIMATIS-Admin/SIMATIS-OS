import { eq } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { diagnosticProjets } from './schema.js';

// Un support d'ouverture final relu comme modèle. Le nom est neutre : le texte sert de modèle de
// structure et de ton, jamais de source de faits sur une autre entreprise.
export type SupportFinal = { nom: string; texte: string };

export const SUPPORTS_FINAUX_MAX = 2;
export const TEXTE_SUPPORT_MAX = 30_000;

// Titre, texte affiché et notes d'orateur de chaque diapositive, dans l'ordre du deck.
export const texteDuSupport = (
  diapositives: { titre: string; texte: string; notes: string }[],
): string =>
  diapositives
    .map((d, i) => `Diapositive ${i + 1} : ${d.titre}\n${d.texte}\nNotes : ${d.notes}`)
    .join('\n\n')
    .slice(0, TEXTE_SUPPORT_MAX);

// Les deux derniers supports archivés comme finaux dans l'instance, hors projet courant, du plus
// récent au plus ancien. Un support non final, ou final sans texte, n'est jamais un modèle.
export async function supportsFinauxPour(
  db: Executor,
  instance: Instance,
  projetId: string,
): Promise<SupportFinal[]> {
  const projets = await withInstance(db, instance.id, (tx) =>
    tx
      .select({
        id: diagnosticProjets.id,
        statut: diagnosticProjets.supportStatut,
        texte: diagnosticProjets.supportTexte,
        le: diagnosticProjets.supportFinalLe,
      })
      .from(diagnosticProjets)
      .where(eq(diagnosticProjets.instanceId, instance.id)),
  );
  return projets
    .filter((p) => p.id !== projetId && p.statut === 'final' && p.texte && p.texte.length > 0)
    .sort((a, b) => (b.le?.getTime() ?? 0) - (a.le?.getTime() ?? 0))
    .slice(0, SUPPORTS_FINAUX_MAX)
    .map((p, i) => ({ nom: `Support final ${i + 1}`, texte: texteDuSupport(p.texte!) }));
}
