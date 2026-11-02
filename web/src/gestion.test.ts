import { describe, expect, it } from 'vitest';
import { aujourdhui, effet12, eurCents, libelleMois, moisDecale, versCents } from './gestion.js';

describe('gestion', () => {
  it('lit un montant saisi à la française', () => {
    expect(versCents('12,5')).toBe(1250);
    expect(versCents('1 234.50')).toBe(123_450);
    expect(versCents('0')).toBeNull();
    expect(versCents('abc')).toBeNull();
    expect(versCents('0,1')).toBe(10);
  });

  it('affiche les centimes seulement s’il y en a', () => {
    expect(eurCents(12_000).replace(/\s/g, ' ')).toBe('120 €');
    expect(eurCents(8_640).replace(/\s/g, ' ')).toBe('86,40 €');
  });

  it('décale les mois à travers les années', () => {
    expect(moisDecale('2026-11', 2)).toBe('2027-01');
    expect(moisDecale('2026-01', -1)).toBe('2025-12');
    expect(libelleMois('2026-11')).toBe('novembre 2026');
  });

  it('calcule l’effet sur 12 mois', () => {
    expect(effet12(12_000, 'mensuelle')).toEqual({ parMois: 12_000, total12: 144_000 });
    expect(effet12(48_000, 'annuelle')).toEqual({ parMois: 4_000, total12: 48_000 });
    expect(effet12(18_000, 'aucune')).toEqual({ parMois: 0, total12: 18_000 });
  });

  it('donne le jour de Paris', () => {
    expect(aujourdhui(new Date('2026-11-12T23:30:00Z'))).toBe('2026-11-13');
  });
});
