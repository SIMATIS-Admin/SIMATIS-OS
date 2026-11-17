import { describe, expect, it } from 'vitest';
import { titreVisio } from './nomenclature.js';

describe('titreVisio', () => {
  const base = { entreprise: 'Atelier Fictif', hote: 'Simatis' };

  it('assemble V, l’entreprise, l’hôte et le motif', () => {
    expect(titreVisio({ ...base, motif: 'Restitution' })).toBe(
      'V - Atelier Fictif x Simatis - Restitution',
    );
  });

  it('omet le motif absent, nul ou blanc', () => {
    const attendu = 'V - Atelier Fictif x Simatis';
    expect(titreVisio(base)).toBe(attendu);
    expect(titreVisio({ ...base, motif: null })).toBe(attendu);
    expect(titreVisio({ ...base, motif: '  ' })).toBe(attendu);
  });

  it('ramène les espaces multiples à un seul', () => {
    expect(titreVisio({ ...base, entreprise: '  Atelier   Fictif ' })).toBe(
      'V - Atelier Fictif x Simatis',
    );
  });

  it('refuse une entreprise vide', () => {
    expect(() => titreVisio({ ...base, entreprise: '   ' })).toThrow();
  });
});
