import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';
import { jourDe } from '../pilotage/realisees.js';
import { ajouterJours, dateEmissionPrevue } from './dates.js';
import type { Projection } from './tresorerie.js';

// Données fictives. La projection part de la date du jour : tout est calculé relativement à elle.
describe('Trésorerie — factures de mandat', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  const base = '/api/i/trf-propre/gestion';
  const aujourdhui = jourDe(new Date());
  let revenuId = '';

  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    await createInstance(t.owner.db, {
      slug: 'trf-propre',
      nom: 'Mon activité',
      type: 'propre',
      config: { modules: ['gestion'] },
    });
    await app.inject({
      method: 'PUT',
      url: `${base}/mandats/trf-a/reglages`,
      payload: { delaiPaiementJours: 30 },
    });
    revenuId = (
      await app.inject({
        method: 'POST',
        url: `${base}/revenus`,
        payload: {
          libelle: 'Commission fictive',
          montantHtCents: 100_000,
          date: aujourdhui,
          mandat: 'trf-a',
        },
      })
    ).json<{ id: string }>().id;
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const entrees = async () => {
    const p = (
      await app.inject({ method: 'GET', url: `${base}/tresorerie?horizon=6` })
    ).json<Projection>();
    const central = p.scenarios.find((s) => s.scenario === 'central')!;
    return central.periodes.flatMap((x) => x.mouvements).filter((m) => m.ref.startsWith(revenuId));
  };

  it('une recette prévue d’un mandat entre une fois, à la fin du mois + le délai du mandat', async () => {
    const m = await entrees();
    expect(m).toHaveLength(1);
    expect(m[0]!.date).toBe(ajouterJours(dateEmissionPrevue(aujourdhui), 30));
  });

  it('une fois la facture émise, elle entre toujours une fois, à l’émission + le délai figé', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `${base}/factures/emettre`,
      payload: { mandat: 'trf-a', numero: 'F-TRF-1', dateEmission: aujourdhui },
    });
    expect(r.statusCode).toBe(201);
    const m = await entrees();
    expect(m).toHaveLength(1);
    expect(m[0]!.date).toBe(ajouterJours(aujourdhui, 30));
  });
});
