import { describe, expect, it } from 'vitest';
import fixtures from '../demo/fixtures.json' with { type: 'json' };
import { funnelSchema, simulerFunnel } from './funnel.js';

describe('dashboard funnel', () => {
  it('gives the mockup figures for the SIMATIS settings', () => {
    const simatis = fixtures.find((f) => f.slug === 'simatis')?.config.funnel;
    const r = simulerFunnel(funnelSchema.parse(simatis));
    expect(r.prospects).toBe(18);
    expect(r.devis).toBeCloseTo(8.1);
    expect(r.commandes).toBeCloseTo(2.835);
    // 60 × 30 % × 45 % × 35 % × 16 000 € × 12, as shown by the mockup.
    expect(Math.round(r.caAnnuel)).toBe(544320);
    expect(r.objectifTenu).toBe(true);
    expect(r.leadsNecessaires).toBe(17);
  });

  it('says how many leads are missing when the target is out of reach', () => {
    const r = simulerFunnel({
      leads: 10,
      l2p: 10,
      p2d: 50,
      d2c: 30,
      panier: 5000,
      objectif: 500000,
    });
    expect(r.objectifTenu).toBe(false);
    expect(r.leadsNecessaires).toBe(556);
  });

  it('rejects values outside the sliders', () => {
    expect(
      funnelSchema.safeParse({ leads: 500, l2p: 30, p2d: 45, d2c: 35, panier: 16000, objectif: 1 })
        .success,
    ).toBe(false);
  });
});
