import { describe, expect, it } from 'vitest';
import { creneauxLibres, zoned, type CreneauxOptions } from './creneaux.js';

const OPTIONS: CreneauxOptions = {
  nombre: 3,
  delaiJours: 2,
  plages: [
    ['09:30', '12:00'],
    ['14:00', '17:00'],
  ],
  tamponMin: 15,
  jours: 'ouvres',
  fuseau: 'Europe/Paris',
};
// Thursday 8 October 2026, 10:00 in Paris.
const JEUDI = zoned('2026-10-08', '10:00', 'Europe/Paris');
const jourParis = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const heureParis = (d: Date) =>
  d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

describe('creneauxLibres', () => {
  it('converts Paris wall-clock times, summer and winter', () => {
    expect(zoned('2026-10-08', '09:30', 'Europe/Paris').toISOString()).toBe(
      '2026-10-08T07:30:00.000Z',
    );
    expect(zoned('2026-12-01', '09:30', 'Europe/Paris').toISOString()).toBe(
      '2026-12-01T08:30:00.000Z',
    );
  });

  it('offers three slots on three different working days, after the delay', () => {
    const slots = creneauxLibres([], OPTIONS, JEUDI);
    expect(slots).toHaveLength(3);
    const days = slots.map(jourParis);
    expect(new Set(days).size).toBe(3);
    // Two working days after Thursday: Monday 12 October at the earliest.
    expect(days[0]).toBe('2026-10-12');
    for (const s of slots) {
      const w = new Date(`${jourParis(s)}T12:00:00Z`).getUTCDay();
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(5);
    }
  });

  it('never offers a Saturday, even with no delay', () => {
    const vendredi = zoned('2026-10-09', '18:00', 'Europe/Paris');
    const slots = creneauxLibres([], { ...OPTIONS, delaiJours: 0, nombre: 5 }, vendredi);
    expect(slots.map((s) => new Date(`${jourParis(s)}T12:00:00Z`).getUTCDay())).not.toContain(6);
    expect(slots.map((s) => new Date(`${jourParis(s)}T12:00:00Z`).getUTCDay())).not.toContain(0);
  });

  it('keeps a meeting and its margin free', () => {
    const lundi = '2026-10-12';
    const reunion = {
      debut: zoned(lundi, '09:00', 'Europe/Paris'),
      fin: zoned(lundi, '17:00', 'Europe/Paris'),
    };
    const slots = creneauxLibres([reunion], { ...OPTIONS, nombre: 1 }, JEUDI);
    expect(jourParis(slots[0] ?? new Date(0))).toBe('2026-10-13');

    const courte = {
      debut: zoned(lundi, '09:30', 'Europe/Paris'),
      fin: zoned(lundi, '10:30', 'Europe/Paris'),
    };
    const [premier] = creneauxLibres([courte], { ...OPTIONS, nombre: 1 }, JEUDI);
    expect(jourParis(premier ?? new Date(0))).toBe(lundi);
    // Not before 10:45 (meeting end + 15 min margin) on that morning.
    expect(premier && premier.getTime() >= courte.fin.getTime() + 15 * 60_000).toBe(true);
    expect(heureParis(premier ?? new Date(0))).not.toBe('10:30');
  });

  it('returns nothing when no slot is asked', () => {
    expect(creneauxLibres([], { ...OPTIONS, nombre: 0 }, JEUDI)).toEqual([]);
  });

  it('respects Monday to Thursday only', () => {
    const slots = creneauxLibres([], { ...OPTIONS, jours: 'lun-jeu', nombre: 4 }, JEUDI);
    const jours = slots.map((s) => new Date(`${jourParis(s)}T12:00:00Z`).getUTCDay());
    expect(jours.every((w) => w >= 1 && w <= 4)).toBe(true);
  });
});
