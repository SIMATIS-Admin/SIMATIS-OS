import {
  normaliserEmail,
  normaliserLinkedin,
  normaliserTelephone,
} from '../base-vivante/nettoyage.js';
import type { baseVivante } from '../base-vivante/schema.js';
import type { Suggestion } from './schema.js';

type Fiche = typeof baseVivante.$inferSelect;

const sansAccent = (v: string | null) =>
  (v ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

// Écriture sans validation : seulement une preuve forte, pour la personne déjà connue de la fiche,
// et seulement dans des champs vides. Une valeur différente de celle déjà en base reste un conflit
// que Marc tranche ; une fiche sans contact ou en opposition ne reçoit jamais rien d'elle-même.
export function ecritureAutomatique(f: Fiche, s: Suggestion): boolean {
  if (s.preuve !== 'page_domaine') return false;
  if (f.opposition || f.exclusion) return false;
  if (!f.nom || sansAccent(f.nom) !== sansAccent(s.nom)) return false;
  if (f.prenom && s.prenom && sansAccent(f.prenom) !== sansAccent(s.prenom)) return false;

  const champs: [string | null, string | null, string | null][] = [
    [f.email, normaliserEmail(s.email), normaliserEmail(f.email)],
    [f.telephone, normaliserTelephone(s.telephone), normaliserTelephone(f.telephone)],
    [f.linkedin, normaliserLinkedin(s.linkedin), normaliserLinkedin(f.linkedin)],
    [f.fonction, s.fonction, f.fonction],
  ];
  let comble = false;
  for (const [actuel, apport, actuelNormalise] of champs) {
    if (!apport) continue;
    if (!actuel) comble = true;
    else if (sansAccent(apport) !== sansAccent(actuelNormalise)) return false;
  }
  return comble;
}
