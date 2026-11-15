import { describe, expect, it } from 'vitest';
import { coefficient, hausseParHeure, nonAttribue, type PointJauge } from './calibrage.js';

const H = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 10, h, m));
const reset = H(20);

describe('hausseParHeure', () => {
  it('mesure la hausse entre le dernier relevé avant l’heure et le dernier de l’heure', () => {
    const points: PointJauge[] = [
      { at: H(9, 55), utilise: 10, reset },
      { at: H(10, 30), utilise: 13, reset },
      { at: H(10, 55), utilise: 15, reset },
    ];
    expect(hausseParHeure(points, [H(10)]).get(H(10).getTime())).toBe(5);
  });

  it('un renouvellement dans l’heure donne null', () => {
    const points: PointJauge[] = [
      { at: H(9, 55), utilise: 80, reset: H(10, 20) },
      { at: H(10, 55), utilise: 4, reset: H(15, 20) },
    ];
    expect(hausseParHeure(points, [H(10)]).get(H(10).getTime())).toBeNull();
  });

  it('une baisse donne null, jamais une hausse négative', () => {
    const points: PointJauge[] = [
      { at: H(9, 55), utilise: 30, reset: null },
      { at: H(10, 55), utilise: 25, reset: null },
    ];
    expect(hausseParHeure(points, [H(10)]).get(H(10).getTime())).toBeNull();
  });

  it('un relevé trop ancien avant l’heure ne mesure pas cette heure', () => {
    const points: PointJauge[] = [
      { at: H(6, 0), utilise: 10, reset },
      { at: H(10, 55), utilise: 30, reset },
    ];
    expect(hausseParHeure(points, [H(10)]).get(H(10).getTime())).toBeNull();
  });

  it('un dernier relevé trop tôt dans l’heure ne la mesure pas', () => {
    const points: PointJauge[] = [
      { at: H(9, 55), utilise: 10, reset },
      { at: H(10, 10), utilise: 12, reset },
    ];
    expect(hausseParHeure(points, [H(10)]).get(H(10).getTime())).toBeNull();
  });

  it('sans relevé à un bout, null', () => {
    const points: PointJauge[] = [{ at: H(10, 30), utilise: 30, reset }];
    expect(hausseParHeure(points, [H(10)]).get(H(10).getTime())).toBeNull();
  });
});

// 10 heures où la hausse vaut 2 × le coût, puis 3 heures où une part non observée ajoute 5 points.
function serie() {
  const hausses = new Map<number, number | null>();
  const couts = new Map<number, number>();
  for (let h = 0; h < 13; h++) {
    const cout = 1 + (h % 3);
    couts.set(H(h).getTime(), cout);
    hausses.set(H(h).getTime(), 2 * cout + (h >= 10 ? 5 : 0));
  }
  return { hausses, couts };
}

describe('coefficient', () => {
  it('le coefficient n’est pas gonflé par une part non observée', () => {
    const { hausses, couts } = serie();
    const c = coefficient(hausses, couts);
    expect(c?.k).toBeCloseTo(2, 2);
  });

  it('estimé sous 20 points', () => {
    const hausses = new Map([[H(1).getTime(), 4]]);
    const couts = new Map([[H(1).getTime(), 2]]);
    expect(coefficient(hausses, couts)).toMatchObject({ k: 2, points: 4, estime: true });
    const { hausses: h2, couts: c2 } = serie();
    expect(coefficient(h2, c2)?.estime).toBe(false);
  });

  it('sans heure exploitable, null', () => {
    expect(coefficient(new Map([[H(1).getTime(), null]]), new Map([[H(1).getTime(), 3]]))).toBe(
      null,
    );
  });
});

describe('nonAttribue', () => {
  it('non attribué apparaît pour la part non observée', () => {
    const { hausses, couts } = serie();
    const c = coefficient(hausses, couts);
    const t = H(10).getTime();
    expect(nonAttribue(hausses.get(t) ?? null, couts.get(t) ?? 0, c)).toBeCloseTo(5, 1);
  });

  it('moins d’un point ou hausse inconnue : rien', () => {
    const c = { k: 2, points: 30, estime: false };
    expect(nonAttribue(4.5, 2, c)).toBe(0);
    expect(nonAttribue(null, 2, c)).toBeNull();
    expect(nonAttribue(4, 2, null)).toBeNull();
  });
});
