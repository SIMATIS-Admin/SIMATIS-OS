import { describe, expect, it } from 'vitest';
import { compterRealisees, dernierJourOuvre, situation } from './realisees.js';

describe('tasks of the day and tasks done', () => {
  it('vigilance 4: a task due on 7 October at 23:30 in Paris is "yesterday" on the 8th and "today" on the 7th', () => {
    const echeance = new Date('2026-10-07T21:30:00Z');
    expect(situation(echeance, new Date('2026-10-08T08:00:00Z'))).toBe('retard');
    expect(situation(echeance, new Date('2026-10-07T08:00:00Z'))).toBe('jour');
    // Late in the evening of the 7th in Paris, but already the 8th in neither: still today.
    expect(situation(echeance, new Date('2026-10-07T21:45:00Z'))).toBe('jour');
  });

  it('counts a task done at 23:30 in Paris for that Paris day', () => {
    const done = [{ canal: 'email' as const, faitAt: new Date('2026-10-07T21:30:00Z') }];
    const counts = compterRealisees(done, new Date('2026-10-08T08:00:00Z'));
    expect(counts.veille).toMatchObject({ jour: '2026-10-07', email: 1, total: 1 });
    expect(counts.aujourdhui.total).toBe(0);
  });

  it('on a Monday, the last working day is the Friday', () => {
    expect(dernierJourOuvre('2026-10-12')).toBe('2026-10-09');
    const done = [
      { canal: 'appel' as const, faitAt: new Date('2026-10-09T09:00:00Z') },
      { canal: 'tache' as const, faitAt: new Date('2026-10-10T09:00:00Z') },
    ];
    const counts = compterRealisees(done, new Date('2026-10-12T08:00:00Z'));
    expect(counts.veille).toMatchObject({ jour: '2026-10-09', appel: 1, autre: 0, total: 1 });
    expect(counts.semaine).toEqual({ email: 0, appel: 1, autre: 1, total: 2 });
  });

  it('keeps a task done 31 days ago out of the month, and open tasks out of every count', () => {
    const now = new Date('2026-10-08T08:00:00Z');
    const done = [
      { canal: 'email' as const, faitAt: new Date('2026-09-07T10:00:00Z') },
      { canal: 'email' as const, faitAt: new Date('2026-09-09T10:00:00Z') },
      { canal: 'email' as const, faitAt: null },
    ];
    expect(compterRealisees(done, now).mois).toEqual({ email: 1, appel: 0, autre: 0, total: 1 });
  });
});
