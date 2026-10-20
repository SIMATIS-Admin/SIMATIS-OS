import { describe, expect, it } from 'vitest';
import type { Grille } from './grille.js';
import { NOTES, scorer, ScoreIncomplet, type ReponseQuestion } from './score.js';

// Grille fictive : deux rubriques ont une question numéro 1 et une question numéro 2.
const grille: Grille = {
  seuil: 6,
  questions: [
    { section: 'R1', numero: 1, libelle: 'Q1', dimension: 'outils', poids: 2 },
    { section: 'R1', numero: 2, libelle: 'Q2', dimension: 'outils', poids: 1 },
    { section: 'R2', numero: 1, libelle: 'Q3', dimension: 'strategie', poids: 1 },
    { section: 'R2', numero: 2, libelle: 'Q4', dimension: 'strategie', poids: 1 },
    { section: 'R3', numero: 1, libelle: 'Q5', dimension: 'polyvalence', poids: 1 },
  ],
};

const reponse = (
  section: string,
  numero: number,
  lettre: ReponseQuestion['reponse'],
): ReponseQuestion => ({
  section,
  numero,
  reponse: lettre,
});

const toutesA: ReponseQuestion[] = [
  reponse('R1', 1, 'A'),
  reponse('R1', 2, 'A'),
  reponse('R2', 1, 'A'),
  reponse('R2', 2, 'A'),
  reponse('R3', 1, 'A'),
];

describe('Calcul des dimensions et du profil', () => {
  it('fixe les notes A=10, B=7, C=4, D=1, E=0', () => {
    expect(NOTES).toEqual({ A: 10, B: 7, C: 4, D: 1, E: 0 });
  });

  it('fait une moyenne pondérée par le poids', () => {
    const r = scorer(
      [
        reponse('R1', 1, 'A'),
        reponse('R1', 2, 'C'),
        reponse('R2', 1, 'A'),
        reponse('R2', 2, 'A'),
        reponse('R3', 1, 'A'),
      ],
      grille,
    );
    // Outils : (2 × 10 + 1 × 4) / 3 = 8.
    expect(r.dims.outils).toBe(8);
    expect(r.profil).toBe('Ultra-endurant');
  });

  it('exclut « N/A » du numérateur et du dénominateur', () => {
    const r = scorer(
      [
        reponse('R1', 1, 'N/A'),
        reponse('R1', 2, 'B'),
        reponse('R2', 1, 'A'),
        reponse('R2', 2, 'A'),
        reponse('R3', 1, 'A'),
      ],
      grille,
    );
    expect(r.dims.outils).toBe(7);
  });

  it('garde les questions de même numéro dans des rubriques différentes séparées', () => {
    const r = scorer(
      [
        reponse('R1', 1, 'A'),
        reponse('R1', 2, 'A'),
        reponse('R2', 1, 'E'),
        reponse('R2', 2, 'E'),
        reponse('R3', 1, 'A'),
      ],
      grille,
    );
    expect(r.dims.outils).toBe(10);
    expect(r.dims.strategie).toBe(0);
    expect(r.profil).toBe('Sprinteur');
  });

  it('refuse une question sans réponse en citant son libellé', () => {
    const sans = toutesA.filter((r) => !(r.section === 'R2' && r.numero === 2));
    expect(() => scorer(sans, grille)).toThrow(ScoreIncomplet);
    expect(() => scorer(sans, grille)).toThrow(/Q4/);
  });

  it('refuse une réponse portant sur une question absente de la grille', () => {
    expect(() => scorer([...toutesA, reponse('R9', 1, 'A')], grille)).toThrow(ScoreIncomplet);
  });

  it('refuse une dimension entièrement en « N/A » au lieu d inventer une note', () => {
    const sansPolyvalence = toutesA.map((r) =>
      r.section === 'R3' ? { ...r, reponse: 'N/A' as const } : r,
    );
    expect(() => scorer(sansPolyvalence, grille)).toThrow(ScoreIncomplet);
  });

  it('donne Joggeur quand la dimension outils reste sous le seuil', () => {
    const r = scorer(
      [
        reponse('R1', 1, 'D'),
        reponse('R1', 2, 'E'),
        reponse('R2', 1, 'A'),
        reponse('R2', 2, 'A'),
        reponse('R3', 1, 'A'),
      ],
      grille,
    );
    expect(r.dims.outils).toBe(0.7);
    expect(r.profil).toBe('Joggeur');
  });
});
