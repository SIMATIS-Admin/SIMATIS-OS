import { describe, expect, it } from 'vitest';
import type { RdvAgenda, TacheVue } from '../../api.js';
import { COULEUR_RDV, couleurRdv, estCreneau, estRendezVous, joursCouverts } from './agenda.js';

const rdv = (extra: Partial<RdvAgenda>): RdvAgenda => ({
  id: 'e1',
  debut: '2026-10-20T08:00:00.000Z',
  fin: '2026-10-20T09:00:00.000Z',
  titre: 'Point fictif',
  lieu: null,
  journee: false,
  agenda: 'primary',
  couleur: null,
  ...extra,
});

describe('Agenda placement', () => {
  it("keeps a meeting's Google colour, else colours it by agenda", () => {
    expect(couleurRdv(rdv({ couleur: '#039be5' }))).toBe('#039be5');
    expect(couleurRdv(rdv({}))).toBe(COULEUR_RDV);
    const autre = couleurRdv(rdv({ agenda: 'equipe@exemple.test' }));
    expect(autre).not.toBe(COULEUR_RDV);
    expect(couleurRdv(rdv({ agenda: 'equipe@exemple.test' }))).toBe(autre);
  });

  it('tells a slot of more than two hours from a meeting', () => {
    expect(estCreneau(rdv({ fin: '2026-10-20T10:00:00.000Z' }))).toBe(false);
    expect(estCreneau(rdv({ fin: '2026-10-20T10:01:00.000Z' }))).toBe(true);
    expect(
      estCreneau(
        rdv({ journee: true, debut: '2026-10-20T00:00:00.000Z', fin: '2026-10-21T00:00:00.000Z' }),
      ),
    ).toBe(false);
  });

  it('puts only timed meetings and lunches on the hour grid', () => {
    const t = (type: TacheVue['type'], avecHeure: boolean) => ({ type, avecHeure }) as TacheVue;
    expect(estRendezVous(t('reunion', true))).toBe(true);
    expect(estRendezVous(t('dejeuner', true))).toBe(true);
    expect(estRendezVous(t('reunion', false))).toBe(false);
    expect(estRendezVous(t('appel', true))).toBe(false);
  });

  it('spreads an all-day event over every day it covers, end date excluded', () => {
    expect(joursCouverts(rdv({}))).toEqual(['2026-10-20']);
    expect(
      joursCouverts(
        rdv({ journee: true, debut: '2026-11-01T00:00:00.000Z', fin: '2026-11-02T00:00:00.000Z' }),
      ),
    ).toEqual(['2026-11-01']);
    expect(
      joursCouverts(
        rdv({ journee: true, debut: '2026-10-20T00:00:00.000Z', fin: '2026-10-23T00:00:00.000Z' }),
      ),
    ).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });
});
