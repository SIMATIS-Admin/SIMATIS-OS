import { describe, expect, it } from 'vitest';
import { decrireScenario } from './scenarios.js';

describe('decrireScenario', () => {
  it('dit les prévisions retenues et le pipe', () => {
    expect(decrireScenario({ certitudes: ['certaine', 'probable'], pipe: 'pondere' })).toBe(
      'recettes facturées ou encaissées + prévisions certaines, probables ; pipe pondéré (montant × probabilité)',
    );
  });

  it('sans prévision, ne garde que le facturé', () => {
    expect(decrireScenario({ certitudes: [], pipe: 'aucun' })).toBe(
      'recettes facturées ou encaissées seulement ; pipe non compté',
    );
  });

  it('range les certitudes dans l’ordre, quel que soit l’ordre de saisie', () => {
    expect(decrireScenario({ certitudes: ['hypothese', 'certaine'], pipe: 'total' })).toContain(
      'certaines, hypothèses',
    );
  });
});
