import { describe, expect, it } from 'vitest';
import { placer, versCreneau } from './placement.js';

describe('placement dans la grille horaire (heure de Paris, 7 h – 21 h)', () => {
  it('places an activity on its half-hour rows', () => {
    const p = placer([{ id: 'a', debut: '2026-10-13T07:00:00Z', minutes: 60 }]);
    expect(p.get('a')).toEqual({ ligne: 4, hauteur: 2, colonne: 0, colonnes: 1 });
  });

  it('puts overlapping activities side by side, and the others full width', () => {
    const p = placer([
      { id: 'a', debut: '2026-10-13T08:00:00Z', minutes: 60 },
      { id: 'b', debut: '2026-10-13T08:30:00Z', minutes: 60 },
      { id: 'c', debut: '2026-10-13T12:00:00Z', minutes: 30 },
    ]);
    expect(p.get('a')).toMatchObject({ colonne: 0, colonnes: 2 });
    expect(p.get('b')).toMatchObject({ colonne: 1, colonnes: 2 });
    expect(p.get('c')).toMatchObject({ colonne: 0, colonnes: 1 });
  });

  it('clamps early and late activities to the grid', () => {
    const p = placer([
      { id: 'tot', debut: '2026-10-13T04:00:00Z', minutes: 30 },
      { id: 'tard', debut: '2026-10-13T20:00:00Z', minutes: 90 },
    ]);
    expect(p.get('tot')?.ligne).toBe(0);
    expect(p.get('tard')).toMatchObject({ ligne: 27, hauteur: 1 });
  });

  it('turns a row back into a UTC instant, summer and winter time', () => {
    expect(versCreneau('2026-10-16', 14)).toBe('2026-10-16T12:00:00.000Z');
    expect(versCreneau('2026-11-02', 0)).toBe('2026-11-02T06:00:00.000Z');
  });
});
