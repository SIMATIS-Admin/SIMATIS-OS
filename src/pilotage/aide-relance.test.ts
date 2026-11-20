import { expect, it } from 'vitest';
import { setupTestApp } from '../../test/database.js';
import { createInstance } from '../instances/service.js';
import {
  lireMasquees,
  masquerAction,
  masquerActions,
  MAX_MASQUE,
  schemaMasque,
  schemaMasqueLot,
} from './aide-relance.js';

const maintenant = Date.parse('2026-11-20T09:00:00Z');
const JOUR = 86_400_000;

it('retient les actions masquées, par instance, et oublie celles dont la date est passée', async () => {
  const t = await setupTestApp();
  try {
    const a = await createInstance(t.owner.db, { slug: 'relance-a', nom: 'A', type: 'propre' });
    const b = await createInstance(t.owner.db, { slug: 'relance-b', nom: 'B', type: 'propre' });
    expect(await lireMasquees(t.app.db, a.id, maintenant)).toEqual({});

    await masquerAction(t.app.db, a.id, 'ent:exemple', maintenant + 3 * JOUR, maintenant);
    await masquerAction(t.app.db, a.id, 'ent:ecartee', MAX_MASQUE, maintenant);
    expect(await lireMasquees(t.app.db, a.id, maintenant)).toEqual({
      'ent:exemple': maintenant + 3 * JOUR,
      'ent:ecartee': MAX_MASQUE,
    });
    // Une autre instance ne voit rien.
    expect(await lireMasquees(t.app.db, b.id, maintenant)).toEqual({});
    // Passé la date du report, l'action revient.
    expect(await lireMasquees(t.app.db, a.id, maintenant + 4 * JOUR)).toEqual({
      'ent:ecartee': MAX_MASQUE,
    });
    // Reporter une seconde fois une même action remplace sa date.
    await masquerAction(t.app.db, a.id, 'ent:exemple', maintenant + 7 * JOUR, maintenant);
    expect((await lireMasquees(t.app.db, a.id, maintenant))['ent:exemple']).toBe(
      maintenant + 7 * JOUR,
    );
  } finally {
    await t.drop();
  }
});

it('refuse un report mal formé', () => {
  expect(schemaMasque.safeParse({ id: 'ent:x', jusqua: 1 }).success).toBe(true);
  expect(schemaMasque.safeParse({ id: '', jusqua: 1 }).success).toBe(false);
  expect(schemaMasque.safeParse({ id: 'x', jusqua: -1 }).success).toBe(false);
  expect(schemaMasque.safeParse({ id: 'x', jusqua: 1.5 }).success).toBe(false);
  expect(schemaMasque.safeParse({ id: 'x', jusqua: 1, autre: 1 }).success).toBe(false);
});

it("masque un lot d'actions en une écriture, sans effacer les reports existants", async () => {
  const t = await setupTestApp();
  try {
    const a = await createInstance(t.owner.db, { slug: 'relance-lot', nom: 'Lot', type: 'propre' });
    await masquerAction(t.app.db, a.id, 'ent:avant', maintenant + JOUR, maintenant);
    await masquerActions(t.app.db, a.id, ['ent:x', 'ent:y', 'ent:z'], MAX_MASQUE, maintenant);
    expect(Object.keys(await lireMasquees(t.app.db, a.id, maintenant)).sort()).toEqual([
      'ent:avant',
      'ent:x',
      'ent:y',
      'ent:z',
    ]);
  } finally {
    await t.drop();
  }
});

it('refuse un lot vide, trop gros ou mal formé', () => {
  expect(schemaMasqueLot.safeParse({ ids: ['a'], jusqua: 1 }).success).toBe(true);
  expect(schemaMasqueLot.safeParse({ ids: [], jusqua: 1 }).success).toBe(false);
  expect(
    schemaMasqueLot.safeParse({ ids: Array.from({ length: 2001 }, (_, i) => `a${i}`), jusqua: 1 })
      .success,
  ).toBe(false);
  expect(schemaMasqueLot.safeParse({ ids: [''], jusqua: 1 }).success).toBe(false);
});
