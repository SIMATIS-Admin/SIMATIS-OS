import { describe, expect, it } from 'vitest';
import { decomposer, mouvementsRemuneration, type Remuneration } from './remuneration.js';

const r = (o: Partial<Remuneration> = {}): Remuneration => ({
  actif: true,
  base: 'brut',
  montantCents: 400_000,
  tauxSalarial: 20,
  tauxPatronal: 40,
  periodicite: 'mensuelle',
  ...o,
});
const p = { soldeDate: null, aujourdhui: '2026-11-12', fin: '2027-02-28' };

describe('decomposer', () => {
  it('part du brut : net = brut − salariales, coût = brut + patronales', () => {
    expect(decomposer(r())).toEqual({
      brutCents: 400_000,
      netCents: 320_000,
      salarialCents: 80_000,
      patronalCents: 160_000,
      urssafCents: 240_000,
      coutCents: 560_000,
    });
  });

  it('part du net visé : retrouve le brut', () => {
    expect(decomposer(r({ base: 'net', montantCents: 320_000 }))).toMatchObject({
      brutCents: 400_000,
      netCents: 320_000,
    });
  });

  it('part du coût total pour la société : retrouve le brut', () => {
    expect(decomposer(r({ base: 'cout', montantCents: 560_000 }))).toMatchObject({
      brutCents: 400_000,
      coutCents: 560_000,
    });
  });
});

describe('mouvementsRemuneration', () => {
  it('mensuel : net en fin de mois, cotisations le 15 du mois suivant, rien dans le passé', () => {
    const m = mouvementsRemuneration(r(), p);
    expect(m.map((x) => [x.date, x.montantCents])).toEqual([
      // Cotisations d'octobre, encore à payer le 15 novembre.
      ['2026-11-15', 240_000],
      ['2026-11-30', 320_000],
      ['2026-12-15', 240_000],
      ['2026-12-31', 320_000],
      ['2027-01-15', 240_000],
      ['2027-01-31', 320_000],
      ['2027-02-15', 240_000],
      ['2027-02-28', 320_000],
    ]);
    expect(m.every((x) => x.sens === 'sortie' && x.estime)).toBe(true);
  });

  it('trimestriel : cotisations de trois mois, le 15 après la fin du trimestre', () => {
    const m = mouvementsRemuneration(r({ periodicite: 'trimestrielle' }), p).filter((x) =>
      x.ref.includes('urssaf'),
    );
    expect(m.map((x) => [x.date, x.montantCents])).toEqual([['2027-01-15', 720_000]]);
  });

  it('inactive : rien', () => {
    expect(mouvementsRemuneration(r({ actif: false }), p)).toEqual([]);
  });

  it('avec un solde, ne projette que ce qui suit sa date', () => {
    const m = mouvementsRemuneration(r(), { ...p, soldeDate: '2026-12-20' });
    expect(m[0]!.date).toBe('2026-12-31');
  });
});
