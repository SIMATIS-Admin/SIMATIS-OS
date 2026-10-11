import { describe, expect, it } from 'vitest';
import {
  anciennete,
  heuresParDefaut,
  heureParis,
  jourParis,
  memeHeure,
  numeroSemaine,
  titreSemaine,
} from './creneaux.js';

describe('dates de la semaine (heure de Paris)', () => {
  it('reads the Paris day and time of an instant', () => {
    expect(jourParis('2026-10-12T22:30:00Z')).toBe('2026-10-13');
    expect(heureParis('2026-10-13T07:21:00Z')).toBe('09:21');
  });

  it('moves an instant to another day at the same Paris time, across a time change', () => {
    expect(memeHeure('2026-10-13T07:00:00Z', '2026-10-16')).toBe('2026-10-16T07:00:00.000Z');
    expect(memeHeure('2026-10-23T07:00:00Z', '2026-11-02')).toBe('2026-11-02T08:00:00.000Z');
    expect(memeHeure(null, '2026-10-16')).toBe('2026-10-16T07:00:00.000Z');
  });

  it('gives the ISO week number and a readable week title', () => {
    expect(numeroSemaine('2026-10-12')).toBe(42);
    expect(numeroSemaine('2026-12-28')).toBe(53);
    expect(numeroSemaine('2027-01-04')).toBe(1);
    expect(titreSemaine('2026-10-12')).toBe('Semaine 42 · 12 – 18 octobre 2026');
    expect(titreSemaine('2026-09-28')).toBe('Semaine 40 · 28 septembre – 4 octobre 2026');
    expect(titreSemaine('2026-12-28')).toBe('Semaine 53 · 28 décembre 2026 – 3 janvier 2027');
  });

  it('says how late a task is', () => {
    const now = new Date('2026-10-14T10:00:00Z');
    expect(anciennete('2026-10-13T07:00:00Z', now)).toBe('hier');
    expect(anciennete('2026-10-11T07:00:00Z', now)).toBe('il y a 3 j');
    expect(anciennete('2026-09-30T07:00:00Z', now)).toBe('il y a 2 sem.');
    expect(anciennete('2026-07-01T07:00:00Z', now)).toBe('il y a 3 mois');
  });

  it('treats a time shared by three tasks or more as a default time, not a real one', () => {
    const iso = ['2026-10-13T07:00:00Z', '2026-10-14T07:00:00Z', '2026-10-15T07:00:00Z'];
    expect(heuresParDefaut([...iso, '2026-10-15T12:30:00Z', null])).toEqual(new Set(['09:00']));
  });
});
