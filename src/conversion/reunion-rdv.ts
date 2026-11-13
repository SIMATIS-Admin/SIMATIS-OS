// Rapprochement d'une réunion Wispr Flow et d'un rendez-vous de l'agenda (spec du 14 novembre 2026).
// Un événement à moins de 3 h de la réunion est « le » rendez-vous attendu ; s'il y en a plusieurs,
// celui qui partage un invité l'emporte, sinon on ne tranche pas.
export const PROCHE_MS = 3 * 3_600_000;

type Reperage = { debut: Date; participants: string[] };

export function plusProche<T>(ref: Reperage, candidats: (Reperage & { cible: T })[]): T | null {
  const proches = candidats.filter(
    (c) => Math.abs(c.debut.getTime() - ref.debut.getTime()) <= PROCHE_MS,
  );
  if (proches.length === 1) return proches[0]!.cible;
  const invites = new Set(ref.participants.map((p) => p.toLowerCase()));
  const communs = proches.filter((c) => c.participants.some((p) => invites.has(p.toLowerCase())));
  return communs.length === 1 ? communs[0]!.cible : null;
}
