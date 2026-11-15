import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../../test/database.js';
import type { LimitesIA } from '../limites.js';
import { noterJauges } from './jauges.js';
import { iaJauges } from './schema.js';

const limites = (actualiseLe: string, chatgpt: 'ok' | 'indisponible' = 'ok'): LimitesIA => ({
  actualiseLe,
  fournisseurs: [
    {
      id: 'claude',
      nom: 'Claude',
      etat: 'ok',
      plan: 'Max',
      fenetre5h: { restant: 84, reinitialiseLe: '2026-11-10T14:00:00.000Z' },
      hebdomadaire: { restant: 59, reinitialiseLe: '2026-11-14T08:00:00.000Z' },
    },
    {
      id: 'chatgpt',
      nom: 'ChatGPT',
      etat: chatgpt,
      plan: null,
      fenetre5h:
        chatgpt === 'ok' ? { restant: 100, reinitialiseLe: '2026-11-10T15:00:00.000Z' } : null,
      hebdomadaire:
        chatgpt === 'ok' ? { restant: 81, reinitialiseLe: '2026-11-15T08:00:00.000Z' } : null,
    },
  ],
});

describe('noterJauges', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(async () => {
    await t.drop();
  });

  it('note chaque relevé une seule fois', async () => {
    expect(await noterJauges(t.app.db, limites('2026-11-10T10:00:00.000Z'))).toBe(2);
    expect(await noterJauges(t.app.db, limites('2026-11-10T10:00:00.000Z'))).toBe(0);
    const lignes = await t.app.db.select().from(iaJauges);
    expect(lignes.find((l) => l.fournisseur === 'claude')).toMatchObject({
      source: 'collecteur',
      utilise5h: 16,
      utiliseHebdo: 41,
    });
  });

  it('ignore un fournisseur indisponible', async () => {
    expect(await noterJauges(t.app.db, limites('2026-11-10T10:05:00.000Z', 'indisponible'))).toBe(
      1,
    );
  });

  it('ne note rien sans date de relevé', async () => {
    expect(await noterJauges(t.app.db, { actualiseLe: null, fournisseurs: [] })).toBe(0);
  });
});
