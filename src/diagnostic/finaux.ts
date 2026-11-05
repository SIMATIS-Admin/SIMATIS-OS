import { withInstance } from '../db/context.js';
import type { Executor } from '../db.js';
import type { Instance } from '../instances/schema.js';
import { exporterDocParLien, type DriveDeps } from './drive.js';
import { texteDuDocx } from './docx-texte.js';
import { diagnosticProjets } from './schema.js';

// Un rapport final relu comme modèle. Le nom est neutre : le texte relu sert de modèle de structure
// et de ton, jamais de source de faits sur une autre entreprise.
export type RapportFinal = { nom: string; version: number | null; texte: string | null };

export const FINAUX_MAX = 2;
export const TEXTE_FINAL_MAX = 30_000;

// Les deux derniers rapports finaux de l'instance, hors projet courant, du plus récent au plus
// ancien. Un export ou une conversion qui échoue laisse `texte` à null : la production continue.
export async function rapportsFinauxPour(
  db: Executor,
  instance: Instance,
  projetId: string,
  deps: DriveDeps,
): Promise<RapportFinal[]> {
  const projets = await withInstance(db, instance.id, (tx) =>
    tx
      .select({ id: diagnosticProjets.id, liens: diagnosticProjets.rapportLiens })
      .from(diagnosticProjets),
  );
  const finales = projets
    .filter((p) => p.id !== projetId)
    .flatMap((p) => p.liens.filter((l) => l.finale))
    .sort((a, b) => b.le.localeCompare(a.le))
    .slice(0, FINAUX_MAX);
  return Promise.all(
    finales.map(async (l, i) => {
      let texte: string | null;
      try {
        texte = texteDuDocx(await exporterDocParLien(instance, l.lien, deps));
      } catch {
        texte = null;
      }
      return {
        nom: `Rapport final ${i + 1}`,
        version: l.version ?? null,
        texte: texte?.slice(0, TEXTE_FINAL_MAX) ?? null,
      };
    }),
  );
}
