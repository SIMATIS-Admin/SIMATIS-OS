import { describe, expect, it } from 'vitest';
import { profilDe, SEUIL } from './profil.js';

describe('Profil du diagnostic (cascade)', () => {
  it('lit le premier maillon sous le seuil', () => {
    expect(profilDe({ outils: 2.5, strategie: 9, polyvalence: 9 })).toBe('Joggeur');
    expect(profilDe({ outils: 7, strategie: 5.3, polyvalence: 9.5 })).toBe('Sprinteur');
    expect(profilDe({ outils: 7, strategie: 7, polyvalence: 3 })).toBe('Marathonien');
    expect(profilDe({ outils: 7, strategie: 7, polyvalence: 7 })).toBe('Ultra-endurant');
  });

  it('accepte le seuil exact (6 passe)', () => {
    expect(SEUIL).toBe(6);
    expect(profilDe({ outils: 6, strategie: 6, polyvalence: 6 })).toBe('Ultra-endurant');
    expect(profilDe({ outils: 5.9, strategie: 9, polyvalence: 9 })).toBe('Joggeur');
  });
});
