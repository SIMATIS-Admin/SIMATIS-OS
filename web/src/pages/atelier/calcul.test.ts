import { describe, expect, it } from 'vitest';
import { entonnoir, echeanceTrimestre } from './calcul.js';

const obj = { ca: 120000, part: 40, panier: 3000, abo: 300, mois: 6, tx1: 25, tx2: 15, taux: 10 };

describe('entonnoir des objectifs', () => {
  it('donne les valeurs de référence avec une part en abonnement', () => {
    expect(entonnoir(obj)).toMatchObject({
      ventes: 24,
      abonnes: 27,
      mrr: 8100,
      rdv: 204,
      contacts: 1360,
      commission: 12000,
      commissionRecurrente: 9720,
    });
  });

  it('part à 0 : aucun abonné et aucune division par zéro', () => {
    const f = entonnoir({ ...obj, part: 0 });
    expect(f.abonnes).toBe(0);
    expect(f.mrr).toBe(0);
    expect(f.ventes).toBe(40);
    expect(Number.isFinite(f.contacts)).toBe(true);
  });

  it('part à 100 : plus de vente ponctuelle', () => {
    expect(entonnoir({ ...obj, part: 100 }).ventes).toBe(0);
  });

  it('champs vides ou texte : valeurs sûres, aucun NaN ni Infinity', () => {
    const f = entonnoir({
      ca: '',
      part: '',
      panier: '',
      abo: '',
      mois: '',
      tx1: '',
      tx2: '',
      taux: '',
    });
    for (const v of Object.values(f)) expect(Number.isFinite(v)).toBe(true);
  });

  it('plafonne les taux de conversion à 100 % et les mois à 12', () => {
    const f = entonnoir({ ...obj, tx1: 250, tx2: 400, mois: 30 });
    expect(f.rdv).toBe(f.ventes + f.abonnes);
    expect(f.abonnes).toBe(Math.ceil(48000 / (300 * 12)));
  });
});

describe('échéance de trimestre', () => {
  it("compte les trimestres à partir de la date de l'atelier, au dernier jour du mois", () => {
    expect(echeanceTrimestre('2026-10-27', 0)).toBe('2027-01-31');
    expect(echeanceTrimestre('2026-10-27', 1)).toBe('2027-04-30');
    expect(echeanceTrimestre('2026-10-27', 3)).toBe('2027-10-31');
  });
});
