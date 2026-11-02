import { describe, expect, it } from 'vitest';
import { normaliserMensuel, occurrencesEntre, veille } from './recurrence.js';

describe('occurrencesEntre', () => {
  it('donne la date unique d’une dépense ponctuelle si elle est dans la période', () => {
    const s = { recurrence: 'aucune' as const, debut: '2026-11-05' };
    expect(occurrencesEntre(s, '2026-11-01', '2026-11-30')).toEqual(['2026-11-05']);
    expect(occurrencesEntre(s, '2026-12-01', '2026-12-31')).toEqual([]);
  });

  it('génère un mois sur deux sans doublon et respecte la fin', () => {
    const s = { recurrence: 'mensuelle' as const, debut: '2026-09-10', fin: '2026-12-31' };
    expect(occurrencesEntre(s, '2026-10-01', '2027-03-31')).toEqual([
      '2026-10-10',
      '2026-11-10',
      '2026-12-10',
    ]);
  });

  it('ramène le 31 au dernier jour des mois courts sans dériver', () => {
    const s = { recurrence: 'mensuelle' as const, debut: '2026-01-31' };
    expect(occurrencesEntre(s, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('gère l’annuelle du 29 février et le passage d’année', () => {
    const s = { recurrence: 'annuelle' as const, debut: '2024-02-29' };
    expect(occurrencesEntre(s, '2024-01-01', '2026-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
    ]);
    const t = { recurrence: 'trimestrielle' as const, debut: '2026-11-15' };
    expect(occurrencesEntre(t, '2026-11-01', '2027-06-30')).toEqual([
      '2026-11-15',
      '2027-02-15',
      '2027-05-15',
    ]);
  });
});

describe('normaliserMensuel', () => {
  it('ramène chaque récurrence à un mois', () => {
    expect(normaliserMensuel(12_000, 'mensuelle')).toBe(12_000);
    expect(normaliserMensuel(30_000, 'trimestrielle')).toBe(10_000);
    expect(normaliserMensuel(120_000, 'annuelle')).toBe(10_000);
    expect(normaliserMensuel(5_000, 'aucune')).toBe(0);
  });
});

describe('veille', () => {
  it('recule d’un jour, y compris sur un changement de mois', () => {
    expect(veille('2026-03-01')).toBe('2026-02-28');
  });
});
