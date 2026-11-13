import { describe, expect, it } from 'vitest';
import { plusProche } from './reunion-rdv.js';

const h = (heure: number, minute = 0) => new Date(Date.UTC(2026, 10, 18, heure, minute));
const cand = (cible: string, debut: Date, participants: string[] = []) => ({
  cible,
  debut,
  participants,
});

describe('plusProche', () => {
  it('retient le seul événement à moins de 3 h', () => {
    const r = plusProche({ debut: h(10), participants: [] }, [
      cand('matin', h(9)),
      cand('soir', h(18)),
    ]);
    expect(r).toBe('matin');
  });

  it('ne retient rien quand aucun événement n’est proche', () => {
    expect(plusProche({ debut: h(10), participants: [] }, [cand('soir', h(18))])).toBeNull();
  });

  it('départage deux événements proches par un invité commun, sans tenir compte de la casse', () => {
    const r = plusProche({ debut: h(10), participants: ['Invite@Exemple.test'] }, [
      cand('a', h(9), ['autre@exemple.test']),
      cand('b', h(11), ['invite@exemple.test']),
    ]);
    expect(r).toBe('b');
  });

  it('ne tranche pas quand plusieurs événements proches ont un invité commun ou aucun', () => {
    const ref = { debut: h(10), participants: ['invite@exemple.test'] };
    expect(plusProche(ref, [cand('a', h(9)), cand('b', h(11))])).toBeNull();
    expect(
      plusProche(ref, [
        cand('a', h(9), ['invite@exemple.test']),
        cand('b', h(11), ['invite@exemple.test']),
      ]),
    ).toBeNull();
  });
});
