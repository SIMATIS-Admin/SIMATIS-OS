import { describe, expect, it } from 'vitest';
import { calculer, contenuSchema } from './devis-contenu.js';

const ligne = (quantite: number, prixUnitaire: number | null) => ({
  libelle: 'Prestation fictive',
  unite: 'forfait' as const,
  quantite,
  prixUnitaire,
});

describe('calculer', () => {
  it('applique la remise puis la TVA, et calcule l’acompte sur le TTC', () => {
    const r = calculer({
      lignes: [ligne(1, 1800), ligne(2, 450)],
      remisePct: 10,
      acomptePct: 30,
    });
    expect(r).toEqual({
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

describe('contenuSchema', () => {
  const base = {
    titre: 'Mission fictive',
    contexte: '',
    objectifs: '',
    inclus: 'Une prestation',
    exclu: '',
    livrables: '',
    debut: null,
    duree: '',
    lignes: [ligne(1, null)],
    remisePct: 0,
    acomptePct: 0,
    frais: 'refactures' as const,
    validiteJours: 30,
    clauses: [],
  };

  it('accepte un contenu valide et une ligne ancienne sans unité', () => {
    expect(contenuSchema.safeParse(base).success).toBe(true);
    const ancienne = { libelle: 'Ancienne ligne', quantite: 1, prixUnitaire: null };
    const r = contenuSchema.parse({ ...base, lignes: [ancienne] });
    expect(r.lignes[0]?.unite).toBe('forfait');
  });

  it('refuse une remise de 101 % et une liste de lignes vide', () => {
    expect(contenuSchema.safeParse({ ...base, remisePct: 101 }).success).toBe(false);
    expect(contenuSchema.safeParse({ ...base, lignes: [] }).success).toBe(false);
  });
});
