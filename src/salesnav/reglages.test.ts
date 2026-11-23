import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { lireReglages, ReglageInvalide, sauverReglages } from './reglages.js';

describe('Réglages du canal Sales Navigator', () => {
  let t: TestApp;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await setupTestApp();
    a = (await createInstance(t.owner.db, { slug: 'sr-a', nom: 'A', type: 'mandat' })).id;
    b = (await createInstance(t.owner.db, { slug: 'sr-b', nom: 'B', type: 'mandat' })).id;
  });

  afterAll(async () => {
    await t.drop();
  });

  const dansA = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, a, fn);

  it('propose 8 par jour, soit 40 par semaine, tant que rien n’est réglé', async () => {
    expect(await dansA((tx) => lireReglages(tx))).toMatchObject({
      quotaJour: 8,
      quotaSemaine: 40,
      pause: false,
      recommande: 8,
      cible: 12,
      quotaMax: 25,
      niveau: 'normal',
    });
  });

  it('enregistre le quota puis le relit, en gardant la pause', async () => {
    await dansA((tx) => sauverReglages(tx, { quotaJour: 12 }));
    await dansA((tx) => sauverReglages(tx, { pause: true }));
    expect(await dansA((tx) => lireReglages(tx))).toMatchObject({
      quotaJour: 12,
      quotaSemaine: 60,
      pause: true,
    });
  });

  it('signale les quotas risqués : orange au-delà de 15, rouge au-delà de 20', async () => {
    expect((await dansA((tx) => sauverReglages(tx, { quotaJour: 15 }))).niveau).toBe('normal');
    expect((await dansA((tx) => sauverReglages(tx, { quotaJour: 16 }))).niveau).toBe('attention');
    expect((await dansA((tx) => sauverReglages(tx, { quotaJour: 20 }))).niveau).toBe('attention');
    expect((await dansA((tx) => sauverReglages(tx, { quotaJour: 21 }))).niveau).toBe('danger');
  });

  it('accepte 0 (tout en pause) et refuse un quota négatif, décimal ou trop grand', async () => {
    expect((await dansA((tx) => sauverReglages(tx, { quotaJour: 0 }))).quotaJour).toBe(0);
    for (const mauvais of [-1, 2.5, 26, Number.NaN]) {
      await expect(
        dansA((tx) => sauverReglages(tx, { quotaJour: mauvais })),
      ).rejects.toBeInstanceOf(ReglageInvalide);
    }
  });

  it('garde chaque espace séparé', async () => {
    await dansA((tx) => sauverReglages(tx, { quotaJour: 18 }));
    expect((await withInstance(t.app.db, b, (tx) => lireReglages(tx))).quotaJour).toBe(8);
  });
});
