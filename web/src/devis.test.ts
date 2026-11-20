import { describe, expect, it } from 'vitest';
import {
  calculer,
  formatNumeroValide,
  problemesAvantEnvoi,
  texteFraisPropose,
  texteSortiePropose,
  type ContenuDevis,
} from './devis.js';

const ligne = (quantite: number, prixUnitaire: number | null) => ({
  libelle: 'Prestation fictive',
  unite: 'forfait' as const,
  quantite,
  prixUnitaire,
});

const complet: ContenuDevis = {
  titre: 'Mission fictive',
  adresse: '',
  attention: '',
  contexte: '',
  objectifs: '',
  inclus: 'Une prestation',
  exclu: 'Un hors périmètre',
  livrables: '',
  debut: null,
  duree: '',
  lignes: [ligne(1, 1000)],
  remisePct: 0,
  acomptePct: 0,
  frais: 'refactures',
  fraisPlafond: null,
  fraisTexte: '',
  modePrix: 'forfait',
  sortieMois: null,
  texteSortie: '',
  conditionsParticulieres: '',
  validiteJours: 30,
  clauses: [],
};

// Mêmes cas que src/conversion/devis-contenu.test.ts : le serveur et l'interface ne partagent
// pas de code, ce test les garde d'accord.
describe('calculer', () => {
  it('applique la remise puis la TVA, et calcule l’acompte sur le TTC', () => {
    expect(
      calculer({ lignes: [ligne(1, 1800), ligne(2, 450)], remisePct: 10, acomptePct: 30 }),
    ).toEqual({
      brut: 2700,
      remise: 270,
      ht: 2430,
      tva: 486,
      ttc: 2916,
      acompte: 874.8,
      prixManquant: false,
    });
  });

  it('signale un prix manquant et le compte pour zéro', () => {
    const r = calculer({ lignes: [ligne(1, 1000), ligne(1, null)], remisePct: 0, acomptePct: 0 });
    expect(r.prixManquant).toBe(true);
    expect(r.brut).toBe(1000);
  });

  it('reste à zéro avec une remise de 100 % ou sans ligne', () => {
    expect(calculer({ lignes: [ligne(1, 500)], remisePct: 100, acomptePct: 50 })).toMatchObject({
      ht: 0,
      ttc: 0,
      acompte: 0,
    });
    expect(calculer({ lignes: [], remisePct: 0, acomptePct: 0 })).toMatchObject({
      brut: 0,
      ttc: 0,
      prixManquant: false,
    });
  });
});

describe('problemesAvantEnvoi', () => {
  it('liste ce qui manque et ne dit rien d’un devis complet', () => {
    const vide = { ...complet, inclus: '', exclu: '', lignes: [ligne(1, null)] };
    expect(problemesAvantEnvoi(vide)).toEqual([
      'Un ou plusieurs prix restent à fixer.',
      'Le périmètre inclus est vide.',
      'Aucune exclusion indiquée : à confirmer.',
    ]);
    expect(problemesAvantEnvoi(complet)).toEqual([]);
  });
});

describe('abonnement et déplacements', () => {
  it('refuse un abonnement à plusieurs lignes ou une sortie après l’engagement', () => {
    const abo = { ...complet, modePrix: 'abonnement' as const, lignes: [ligne(12, 2500)] };
    expect(problemesAvantEnvoi(abo)).toEqual([]);
    expect(problemesAvantEnvoi({ ...abo, lignes: [ligne(12, 2500), ligne(1, 100)] })).toHaveLength(
      1,
    );
    expect(problemesAvantEnvoi({ ...abo, sortieMois: 13 })).toHaveLength(1);
    expect(problemesAvantEnvoi({ ...abo, sortieMois: 6 })).toEqual([]);
  });

  it('propose les mêmes phrases que le serveur', () => {
    expect(texteSortiePropose(12, null)).toBe('Engagement de 12 mois.');
    expect(texteSortiePropose(12, 6)).toContain('6e mois');
    expect(texteFraisPropose('plafonnes', 60)).toContain('60 € HT');
    expect(texteFraisPropose('inclus', null)).toBe('inclus dans le prix.');
    expect(texteFraisPropose('refactures', null)).toBe('refacturés au réel, sur justificatifs.');
  });
});

describe('formatNumeroValide', () => {
  it('suit la même règle que le serveur', () => {
    expect(formatNumeroValide('DEV-{AAAA}-{NNN}')).toBe(true);
    expect(formatNumeroValide('DEV-{AAAA}')).toBe(false);
    expect(formatNumeroValide('DEV-V{NNN}')).toBe(false);
    expect(formatNumeroValide('{AAAA}-{AAAA}-{NNN}')).toBe(false);
    expect(formatNumeroValide('{AAAA}/{NNN}')).toBe(false);
  });
});
