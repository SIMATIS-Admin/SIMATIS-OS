import type { Projet } from './schema.js';

// Pré-requis du rapport : le résultat de l'étape 2 et la revue validée à l'étape 3.
export function rapportPret(
  projet: Pick<Projet, 'dims' | 'revue'>,
): { ok: true } | { ok: false; raison: string } {
  if (!projet.dims) return { ok: false, raison: "Saisissez d'abord le résultat à l'étape 2." };
  if (projet.revue?.statut !== 'validée')
    return { ok: false, raison: "Validez d'abord la revue à l'étape 3." };
  return { ok: true };
}
