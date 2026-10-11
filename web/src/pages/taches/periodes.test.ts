import { describe, expect, it } from 'vitest';
import { periode } from './periodes.js';

describe('périodes de la liste (jours de Paris)', () => {
  const dimanche = new Date('2026-10-11T10:00:00Z');

  it('gives today, tomorrow and overdue', () => {
    expect(periode('aujourdhui', dimanche)).toEqual({ du: '2026-10-11', au: '2026-10-11' });
    expect(periode('demain', new Date('2026-10-31T10:00:00Z'))).toEqual({
      du: '2026-11-01',
      au: '2026-11-01',
    });
    expect(periode('retard', dimanche)).toBe('retard');
  });

  it('gives this week and next week, Monday to Sunday', () => {
    expect(periode('semaine', dimanche)).toEqual({ du: '2026-10-05', au: '2026-10-11' });
    expect(periode('prochaine', dimanche)).toEqual({ du: '2026-10-12', au: '2026-10-18' });
    expect(periode('prochaine', new Date('2026-10-28T10:00:00Z'))).toEqual({
      du: '2026-11-02',
      au: '2026-11-08',
    });
  });
});
