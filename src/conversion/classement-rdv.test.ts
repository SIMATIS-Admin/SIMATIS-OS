import { describe, expect, it } from 'vitest';
import { classerEvenement } from './classement-rdv.js';

const h = (heure: number, minute = 0) => new Date(Date.UTC(2026, 10, 18, heure, minute));
const evenement = (o: Partial<Parameters<typeof classerEvenement>[0]> = {}) => ({
  journee: false,
  participants: ['invite@exemple.test'],
  debut: h(9),
  fin: h(10),
  recurrent: false,
  visio: false,
  ...o,
});

describe('classerEvenement', () => {
  it('range une journée entière dans l’organisation', () => {
    expect(classerEvenement(evenement({ journee: true }), true)).toBe('ignore');
  });

  it('range une série récurrente dans l’organisation, même en visio avec un contact connu', () => {
    expect(classerEvenement(evenement({ recurrent: true, visio: true }), true)).toBe('ignore');
  });

  it('range un bloc sans invité ni visio dans l’organisation', () => {
    expect(classerEvenement(evenement({ participants: [] }), false)).toBe('ignore');
  });

  it('retient comme rendez-vous un invité connu du CRM, d’une heure', () => {
    expect(classerEvenement(evenement(), true)).toBe('rdv');
  });

  it('retient comme rendez-vous une visio d’une demi-heure avec un invité inconnu', () => {
    expect(classerEvenement(evenement({ fin: h(9, 30), visio: true }), false)).toBe('rdv');
  });

  it('laisse à confirmer un invité inconnu sans visio', () => {
    expect(classerEvenement(evenement(), false)).toBe('a_trier');
  });

  it('laisse à confirmer une visio sans invité, qui n’est pas clairement un rendez-vous', () => {
    expect(classerEvenement(evenement({ participants: [], visio: true }), false)).toBe('a_trier');
  });

  it('laisse à confirmer ce qui dure moins de 15 min ou plus de 2 h, même avec un contact connu', () => {
    expect(classerEvenement(evenement({ fin: h(9, 10) }), true)).toBe('a_trier');
    expect(classerEvenement(evenement({ fin: h(11, 30) }), true)).toBe('a_trier');
  });
});
