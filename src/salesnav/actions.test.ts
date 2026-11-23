import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { ActionInvalide, ActionRefusee, enregistrerAction, indicateurs } from './actions.js';
import { sauverReglages } from './reglages.js';

describe('Journal des actions SalesNav', () => {
  let t: TestApp;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await setupTestApp();
    a = (await createInstance(t.owner.db, { slug: 'ac-a', nom: 'A', type: 'mandat' })).id;
    b = (await createInstance(t.owner.db, { slug: 'ac-b', nom: 'B', type: 'mandat' })).id;
  });

  afterAll(async () => {
    await t.drop();
  });

  const dansA = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, a, fn);

  it('compte les quatre types d’action, au jour et à la semaine', async () => {
    await dansA((tx) => sauverReglages(tx, { quotaJour: 20 }));
    for (const type of [
      'demande_envoyee',
      'demande_envoyee',
      'demande_recue',
      'message_envoye',
      'reponse_recue',
    ]) {
      await dansA((tx) => enregistrerAction(tx, { type }));
    }
    const i = await dansA((tx) => indicateurs(tx));
    expect(i.jour).toEqual({
      demande_envoyee: 2,
      demande_recue: 1,
      message_envoye: 1,
      reponse_recue: 1,
    });
    expect(i.semaine).toEqual(i.jour);
    expect(i.restantAujourdhui).toBe(18);
  });

  it('ne compte dans la semaine que les 7 derniers jours de Paris, et dans le jour que celui d’aujourd’hui', async () => {
    const dans = (jours: number) => new Date(Date.now() + jours * 24 * 3600_000);
    // Vu d'il y a 3 jours, ces actions sont d'aujourd'hui ; vu d'aujourd'hui, elles datent de 3 jours.
    const i3 = await dansA((tx) => indicateurs(tx, dans(3)));
    expect(i3.jour.demande_envoyee).toBe(0);
    expect(i3.semaine.demande_envoyee).toBe(2);
    const i10 = await dansA((tx) => indicateurs(tx, dans(10)));
    expect(i10.semaine.demande_envoyee).toBe(0);
  });

  it('refuse une demande au-delà du quota du jour, mais pas une demande reçue', async () => {
    await dansA((tx) => sauverReglages(tx, { quotaJour: 2 }));
    await expect(
      dansA((tx) => enregistrerAction(tx, { type: 'demande_envoyee' })),
    ).rejects.toBeInstanceOf(ActionRefusee);
    await dansA((tx) => enregistrerAction(tx, { type: 'demande_recue' }));
    expect((await dansA((tx) => indicateurs(tx))).restantAujourdhui).toBe(0);
  });

  it('refuse les envois quand le canal est en pause, mais enregistre les réponses reçues', async () => {
    await dansA((tx) => sauverReglages(tx, { quotaJour: 25, pause: true }));
    for (const type of ['demande_envoyee', 'message_envoye']) {
      await expect(dansA((tx) => enregistrerAction(tx, { type }))).rejects.toBeInstanceOf(
        ActionRefusee,
      );
    }
    const avant = (await dansA((tx) => indicateurs(tx))).jour.reponse_recue;
    await dansA((tx) => enregistrerAction(tx, { type: 'reponse_recue' }));
    expect((await dansA((tx) => indicateurs(tx))).jour.reponse_recue).toBe(avant + 1);
    await dansA((tx) => sauverReglages(tx, { pause: false }));
  });

  it('refuse un type inconnu', async () => {
    await expect(dansA((tx) => enregistrerAction(tx, { type: 'autre' }))).rejects.toBeInstanceOf(
      ActionInvalide,
    );
  });

  it('garde chaque espace séparé', async () => {
    const i = await withInstance(t.app.db, b, (tx) => indicateurs(tx));
    expect(i.semaine).toEqual({
      demande_envoyee: 0,
      demande_recue: 0,
      message_envoye: 0,
      reponse_recue: 0,
    });
    expect(i.quotaJour).toBe(8);
  });
});
