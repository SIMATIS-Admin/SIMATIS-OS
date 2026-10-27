import { describe, expect, it } from 'vitest';
import { montantEur, sommeEur, sommes } from './crm.js';

const spot = (montant: number | null) => ({ montant, modeFacturation: 'spot' as const });
const abo = (montant: number | null) => ({ montant, modeFacturation: 'recurrent' as const });

describe('montants spot et récurrents', () => {
  it('affiche /mois seulement pour un abonnement', () => {
    expect(montantEur(spot(5000))).toBe('5 000 €');
    expect(montantEur(abo(1200))).toBe('1 200 €/mois');
    expect(montantEur(abo(null))).toBe('');
  });

  it("n'additionne jamais l'unique et le mensuel", () => {
    const s = sommes([spot(1000), spot(500), abo(300), abo(null)]);
    expect(s).toEqual({ spot: 1500, mensuel: 300 });
    expect(sommeEur(s)).toBe('1 500 € + 300 €/mois');
  });

  it('pondère chaque colonne', () => {
    expect(sommes([spot(1000), abo(200)], () => 0.5)).toEqual({ spot: 500, mensuel: 100 });
  });

  it('montre 0 € sans rien, et seulement le mensuel quand il est seul', () => {
    expect(sommeEur(sommes([]))).toBe('0 €');
    expect(sommeEur(sommes([abo(300)]))).toBe('300 €/mois');
  });
});
