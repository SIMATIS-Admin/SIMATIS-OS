import { describe, expect, it } from 'vitest';
import { calculer, contenuSchema, texteFraisPropose } from './devis-contenu.js';

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

  it('lit l’adresse et l’attention du destinataire, vides sur un contenu ancien', () => {
    const ancien = contenuSchema.parse(base);
    expect(ancien.adresse).toBe('');
    expect(ancien.attention).toBe('');
    const r = contenuSchema.parse({ ...base, adresse: '1 rue Fictive', attention: '  Camille  ' });
    expect(r).toMatchObject({ adresse: '1 rue Fictive', attention: 'Camille' });
    expect(contenuSchema.safeParse({ ...base, adresse: 'x'.repeat(501) }).success).toBe(false);
    expect(contenuSchema.safeParse({ ...base, attention: 'x'.repeat(201) }).success).toBe(false);
  });

  it('lit les champs d’abonnement, de déplacement et de conditions, vides sur un contenu ancien', () => {
    const ancien = contenuSchema.parse(base);
    expect(ancien).toMatchObject({
      modePrix: 'forfait',
      sortieMois: null,
      texteSortie: '',
      fraisPlafond: null,
      fraisTexte: '',
      conditionsParticulieres: '',
    });
    const r = contenuSchema.parse({
      ...base,
      modePrix: 'abonnement',
      sortieMois: 6,
      frais: 'plafonnes',
      fraisPlafond: 60,
    });
    expect(r).toMatchObject({ modePrix: 'abonnement', sortieMois: 6, fraisPlafond: 60 });
    expect(contenuSchema.safeParse({ ...base, modePrix: 'autre' }).success).toBe(false);
    expect(contenuSchema.safeParse({ ...base, sortieMois: 0 }).success).toBe(false);
  });

  it('propose une phrase de déplacement selon le mode', () => {
    expect(texteFraisPropose('inclus', null)).toBe('inclus dans le prix.');
    expect(texteFraisPropose('refactures', null)).toBe('refacturés au réel, sur justificatifs.');
    expect(texteFraisPropose('plafonnes', 60)).toBe(
      'refacturés au réel, plafonnés à 60 € HT par aller-retour.',
    );
    expect(texteFraisPropose('plafonnes', null)).toBe('refacturés au réel, sur justificatifs.');
  });

  it('refuse une remise de 101 % et une liste de lignes vide', () => {
    expect(contenuSchema.safeParse({ ...base, remisePct: 101 }).success).toBe(false);
    expect(contenuSchema.safeParse({ ...base, lignes: [] }).success).toBe(false);
  });
});
