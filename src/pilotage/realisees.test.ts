import { describe, expect, it } from 'vitest';
import { compterRdvTenus, compterRealisees, dernierJourOuvre, situation } from './realisees.js';

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

  it('counts meetings held: ended, timed, with a guest; by Paris day of their start', () => {
    const now = new Date('2026-10-12T10:00:00Z'); // Monday
    const rdv = (
      debut: string,
      fin: string,
      extra: { journee?: boolean; participants?: string[] } = {},
    ) => ({
      debut: new Date(debut),
      fin: new Date(fin),
      journee: extra.journee ?? false,
      participants: extra.participants ?? ['client@exemple.test'],
    });
    const counts = compterRdvTenus(
      [
        rdv('2026-10-09T08:00:00Z', '2026-10-09T09:00:00Z'), // Friday: last working day
        rdv('2026-10-09T22:30:00Z', '2026-10-09T23:00:00Z'), // Saturday 00:30 in Paris
        rdv('2026-10-09T12:00:00Z', '2026-10-09T13:00:00Z', { participants: [] }), // personal block
        rdv('2026-10-09T00:00:00Z', '2026-10-10T00:00:00Z', { journee: true }), // all day
        rdv('2026-10-12T09:30:00Z', '2026-10-12T10:30:00Z'), // not over yet
        rdv('2026-10-12T07:00:00Z', '2026-10-12T08:00:00Z'), // held this morning
        rdv('2026-09-12T08:00:00Z', '2026-09-12T09:00:00Z'), // 30 days ago: out of the month
        rdv('2026-09-14T08:00:00Z', '2026-09-14T09:00:00Z'),
      ],
      now,
    );
    expect(counts).toEqual({ veille: 1, semaine: 3, mois: 4 });
  });
});
