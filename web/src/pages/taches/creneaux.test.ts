import { describe, expect, it } from 'vitest';
import { creneau, vers } from './creneaux.js';

describe('creneaux de la semaine (heure de Paris)', () => {
  it('places an instant in its day column and half-hour row from 8:00', () => {
    expect(creneau('2026-10-13T07:30:00Z')).toEqual({ jour: 1, ligne: 3 });
    expect(creneau('2026-10-12T06:00:00Z')).toEqual({ jour: 0, ligne: 0 });
  });

  it('groups the weekend in one column', () => {
    expect(creneau('2026-10-17T08:00:00Z').jour).toBe(5);
    expect(creneau('2026-10-18T08:00:00Z').jour).toBe(5);
  });

  it('clamps early and late hours, and puts midnight on top as « no time »', () => {
    expect(creneau('2026-10-13T04:00:00Z').ligne).toBe(0);
    expect(creneau('2026-10-13T20:00:00Z').ligne).toBe(23);
    expect(creneau('2026-10-12T22:00:00Z')).toEqual({ jour: 1, ligne: -1 });
  });

  it('turns a dropped slot back into a UTC instant, summer and winter time', () => {
    expect(vers('2026-10-12', 1, 3)).toBe('2026-10-13T07:30:00.000Z');
    expect(vers('2026-11-02', 0, 0)).toBe('2026-11-02T07:00:00.000Z');
    expect(vers('2026-10-12', 5, 2)).toBe('2026-10-17T07:00:00.000Z');
  });
});
