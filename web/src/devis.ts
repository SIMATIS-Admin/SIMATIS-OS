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

// Proposed wordings, same texts as src/conversion/devis-contenu.ts: the pilot can rewrite them.
export const texteFraisPropose = (frais: ContenuDevis['frais'], plafond: number | null) =>
  frais === 'inclus'
    ? 'inclus dans le prix.'
    : frais === 'plafonnes' && plafond !== null
      ? `refacturés au réel, plafonnés à ${plafond} € HT par aller-retour.`
      : 'refacturés au réel, sur justificatifs.';

export const texteSortiePropose = (engagement: number, sortie: number | null) =>
  sortie === null
    ? `Engagement de ${engagement} mois.`
    : `Engagement de ${engagement} mois, avec possibilité de sortie à partir du ${sortie === 1 ? '1er' : `${sortie}e`} mois.`;

export function problemesAvantEnvoi(c: ContenuDevis): string[] {
  const p: string[] = [];
  if (c.modePrix === 'abonnement') {
    if (c.lignes.length !== 1) p.push('Un abonnement a une seule ligne de prix.');
    else if (c.sortieMois !== null && c.sortieMois > (c.lignes[0]?.quantite ?? 0))
      p.push('La sortie anticipée doit tomber pendant l’engagement.');
  }
  if (calculer(c).prixManquant) p.push('Un ou plusieurs prix restent à fixer.');
  if (!c.inclus.trim()) p.push('Le périmètre inclus est vide.');
  if (!c.exclu.trim()) p.push('Aucune exclusion indiquée : à confirmer.');
  return p;
}

const COMPTEUR = /\{(N+)\}/;

// Same rule as src/conversion/devis-parametres.ts, to warn before sending.
export const formatNumeroValide = (format: string) => {
  if (format.length === 0 || format.length > 40 || !/^[\w\-. {}]+$/.test(format)) return false;
  if ((format.match(/\{AAAA\}/g) ?? []).length > 1) return false;
  if ((format.match(/\{N+\}/g) ?? []).length !== 1) return false;
  return !/-V\d+$/i.test(exempleNumero(format, 2026, 1));
};

export const exempleNumero = (format: string, annee: number, compteur = 7) =>
  format
    .replace('{AAAA}', String(annee))
    .replace(COMPTEUR, (_, n: string) => String(compteur).padStart(n.length, '0'));
