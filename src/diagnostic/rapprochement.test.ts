import { describe, expect, it } from 'vitest';
import { proposerRapprochements } from './rapprochement.js';

const entreprises = [
  { id: 'e1', nom: 'Entreprise Fictive A' },
  { id: 'e2', nom: 'Atelier Fictif B' },
  { id: 'e3', nom: 'Atelier Fictif B SARL' },
];

describe('Diagnostic : rapprochement des projets existants', () => {
  it('rapproche un nom identique à la casse et aux accents près', () => {
    expect(
      proposerRapprochements([{ id: 'p1', nom: 'entreprise fictive a' }], entreprises),
    ).toEqual([
      {
        projetId: 'p1',
        statut: 'exact',
        entrepriseId: 'e1',
        entrepriseNom: 'Entreprise Fictive A',
      },
    ]);
  });

  it('signale une ambiguïté au lieu de choisir', () => {
    const doublons = [
      { id: 'e2', nom: 'Atelier Fictif B' },
      { id: 'e4', nom: 'atelier fictif b' },
    ];
    const [p] = proposerRapprochements([{ id: 'p2', nom: 'Atelier Fictif B' }], doublons);
    expect(p).toEqual({
      projetId: 'p2',
      statut: 'ambigu',
      candidates: [
        { entrepriseId: 'e2', entrepriseNom: 'Atelier Fictif B' },
        { entrepriseId: 'e4', entrepriseNom: 'atelier fictif b' },
      ],
    });
  });

  it('laisse sans proposition un nom sans correspondance', () => {
    expect(proposerRapprochements([{ id: 'p3', nom: 'Inconnue' }], entreprises)).toEqual([
      { projetId: 'p3', statut: 'aucun' },
    ]);
  });

  it('ignore la ponctuation et les espaces multiples', () => {
    expect(
      proposerRapprochements([{ id: 'p4', nom: '  Entreprise   Fictive, A. ' }], entreprises),
    ).toEqual([
      {
        projetId: 'p4',
        statut: 'exact',
        entrepriseId: 'e1',
        entrepriseNom: 'Entreprise Fictive A',
      },
    ]);
  });
});
