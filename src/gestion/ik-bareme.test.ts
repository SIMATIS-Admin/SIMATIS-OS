import { describe, expect, it } from 'vitest';
import {
  indemniteCumulee,
  indemnitesParTrajet,
  tranchesValides,
  type Tranche,
} from './ik-bareme.js';

// Taux fictifs, sans rapport avec un barème réel.
const T: Tranche[] = [
  { deKm: 0, jusquaKm: 100, tauxDixMilliemes: 5000, forfaitCents: 0 },
  { deKm: 100, jusquaKm: 200, tauxDixMilliemes: 3000, forfaitCents: 2000 },
  { deKm: 200, jusquaKm: null, tauxDixMilliemes: 2000, forfaitCents: 5000 },
];

describe('barème IK à tranches avec forfait', () => {
  it('calcule l’indemnité cumulée tranche par tranche', () => {
    expect(indemniteCumulee(T, 0)).toBe(0);
    expect(indemniteCumulee(T, 100)).toBe(5000);
    expect(indemniteCumulee(T, 101)).toBe(Math.round(101 * 30) + 2000);
    expect(indemniteCumulee(T, 300)).toBe(300 * 20 + 5000);
  });

  it('l’indemnité d’une période est la différence des cumuls, pas km × taux', () => {
    const [a, b] = indemnitesParTrajet(T, 90, [20, 20]);
    expect(a!.indemniteCents).toBe(indemniteCumulee(T, 110) - indemniteCumulee(T, 90));
    expect(a!.cumulKm).toBe(110);
    expect(b!.cumulKm).toBe(130);
    expect(a!.indemniteCents + b!.indemniteCents).toBe(
      indemniteCumulee(T, 130) - indemniteCumulee(T, 90),
    );
    // Franchir une tranche avec forfait peut baisser l’indemnité marginale : c’est le barème.
    expect(a!.indemniteCents).not.toBe(Math.round(20 * 50));
  });

  it('refuse un barème incohérent', () => {
    expect(tranchesValides(T)).toBe(true);
    expect(tranchesValides([])).toBe(false);
    expect(tranchesValides([{ ...T[0]!, deKm: 5 }])).toBe(false);
    expect(tranchesValides([T[0]!, { ...T[1]!, deKm: 120 }])).toBe(false);
    expect(tranchesValides([{ ...T[0]!, jusquaKm: null }, T[1]!])).toBe(false);
    expect(tranchesValides([T[0]!, T[1]!])).toBe(false);
  });
});
