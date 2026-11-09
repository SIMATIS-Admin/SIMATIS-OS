// Barème kilométrique à tranches avec forfait. Aucun taux n'est codé ici : les tranches viennent d'un
// barème saisi et validé par Marc ou son comptable. Le taux est en dix-millièmes d'euro par km, pour
// calculer en entiers.
export type Tranche = {
  deKm: number;
  // null = dernière tranche, sans plafond.
  jusquaKm: number | null;
  tauxDixMilliemes: number;
  forfaitCents: number;
};

export function tranchesValides(tranches: Tranche[]): boolean {
  if (tranches.length === 0 || tranches[0]!.deKm !== 0) return false;
  return tranches.every((t, i) => {
    const derniere = i === tranches.length - 1;
    if (derniere) return t.jusquaKm === null;
    return t.jusquaKm !== null && t.jusquaKm > t.deKm && tranches[i + 1]!.deKm === t.jusquaKm;
  });
}

// Indemnité due pour un kilométrage annuel cumulé : la tranche qui contient le total s'applique à
// l'ensemble des kilomètres, plus son forfait.
export function indemniteCumulee(tranches: Tranche[], km: number): number {
  if (km <= 0) return 0;
  const t = tranches.find((x) => km > x.deKm && (x.jusquaKm === null || km <= x.jusquaKm));
  if (!t) return 0;
  return Math.round((km * t.tauxDixMilliemes) / 100) + t.forfaitCents;
}

export type LigneIndemnite = { km: number; cumulKm: number; indemniteCents: number };

// Trajets déjà triés par date ; `kmAvant` = kilométrage cumulé de l'année avant le premier.
export function indemnitesParTrajet(
  tranches: Tranche[],
  kmAvant: number,
  kms: number[],
): LigneIndemnite[] {
  let cumul = kmAvant;
  return kms.map((km) => {
    const avant = indemniteCumulee(tranches, cumul);
    cumul += km;
    return { km, cumulKm: cumul, indemniteCents: indemniteCumulee(tranches, cumul) - avant };
  });
}
