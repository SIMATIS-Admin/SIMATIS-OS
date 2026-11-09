import { withInstance } from '../db/context.js';
import type { Executor } from '../db.js';
import type { Instance } from '../instances/schema.js';
import { diagnosticProjets } from './schema.js';

// Un deck de restitution final relu comme modèle. Le nom est neutre : le deck sert de modèle de
// plan, de durée et de ton, jamais de source de faits sur une autre entreprise. Le texte n'est pas
// stocké : Claude le relit sur le lien.
export type RestitutionFinale = { nom: string; lien: string };

export const RESTITUTIONS_FINALES_MAX = 2;

// Les deux derniers decks cochés comme finaux dans l'instance, hors projet courant, du plus récent
// au plus ancien.
export async function restitutionsFinalesPour(
  db: Executor,
  instance: Instance,
  projetId: string,
): Promise<RestitutionFinale[]> {
  const projets = await withInstance(db, instance.id, (tx) =>
    tx
      .select({ id: diagnosticProjets.id, liens: diagnosticProjets.restitutionLiens })
      .from(diagnosticProjets),
  );
  return projets
    .filter((p) => p.id !== projetId)
    .flatMap((p) => p.liens.filter((l) => l.finale))
    .sort((a, b) => b.le.localeCompare(a.le))
    .slice(0, RESTITUTIONS_FINALES_MAX)
    .map((l, i) => ({ nom: `Deck final ${i + 1}`, lien: l.lien }));
}
