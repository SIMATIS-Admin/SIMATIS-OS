// Profil d'entreprise du Diagnostic d'Endurance Commerciale : cascade sur trois dimensions, chacune
// devant atteindre le seuil, dans l'ordre. Le premier maillon qui casse donne le profil.
export const SEUIL = 6;

export const PROFILS = ['Joggeur', 'Sprinteur', 'Marathonien', 'Ultra-endurant'] as const;
export type Profil = (typeof PROFILS)[number];

export type Dimensions = { outils: number; strategie: number; polyvalence: number };

export function profilDe(dims: Dimensions): Profil {
  if (dims.outils < SEUIL) return 'Joggeur';
  if (dims.strategie < SEUIL) return 'Sprinteur';
  if (dims.polyvalence < SEUIL) return 'Marathonien';
  return 'Ultra-endurant';
}
