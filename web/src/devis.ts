import type { ContenuDevis, LigneDevis } from './api.js';

export type { Clause, ContenuDevis, LigneDevis } from './api.js';

const centimes = (x: number) => Math.round(x * 100) / 100;

type Montants = { lignes: LigneDevis[]; remisePct: number; acomptePct: number };

// Same arithmetic as src/conversion/devis-contenu.ts: the preview follows each keystroke
// without a round trip.
export function calculer(c: Montants, tvaPct = 20) {
  const brut = c.lignes.reduce((a, l) => a + (l.prixUnitaire ?? 0) * l.quantite, 0);
  const remise = centimes((brut * c.remisePct) / 100);
  const ht = centimes(brut - remise);
  const tva = centimes((ht * tvaPct) / 100);
  const ttc = centimes(ht + tva);
  return {
    brut,
    remise,
    ht,
    tva,
    ttc,
    acompte: centimes((ttc * c.acomptePct) / 100),
    prixManquant: c.lignes.some((l) => l.prixUnitaire === null),
  };
}

export function problemesAvantEnvoi(c: ContenuDevis): string[] {
  const p: string[] = [];
  if (calculer(c).prixManquant) p.push('Un ou plusieurs prix restent à fixer.');
  if (!c.inclus.trim()) p.push('Le périmètre inclus est vide.');
  if (!c.exclu.trim()) p.push('Aucune exclusion indiquée : à confirmer.');
  return p;
}
