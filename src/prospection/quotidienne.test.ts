import { expect, it, vi } from 'vitest';
import { setupTestApp } from '../../test/database.js';
import { insererFiche } from '../../test/fiche-base.js';
import { createInstance } from '../instances/service.js';
import { withInstance } from '../db/context.js';
import { prospectionBrouillons, prospectionCampagnes } from './schema.js';
import {
  sauverRoutineBrouillons,
  tournerBrouillons,
  lireRoutineBrouillons,
} from './quotidienne.js';

it('prépare les premiers mails une seule fois avec un lien par contact', async () => {
  const t = await setupTestApp();
  try {
    const instance = await createInstance(t.owner.db, {
      slug: 'quotidien-test',
      nom: 'Test',
      type: 'propre',
    });
    for (const [nom, email] of [
      ['Martin', 'alice@atelier.test'],
      ['Petit', 'paul@atelier.test'],
      ['Bureau', 'contact@atelier.test'],
    ] as const) {
      await insererFiche(t.owner.db, {
        instanceId: instance.id,
        entreprise: 'Atelier Fictif',
        nom,
        email,
        provenance: 'Test',
        zone: 'prospectable',
      });
    }
    await sauverRoutineBrouillons(t.app.db, instance.id, { active: true, heure: '10:00' });
    const http = vi.fn(() =>
      Promise.resolve(
        Response.json({
          id: http.mock.calls.length.toString().padStart(32, '0'),
          expireLe: '2027-01-01T00:00:00Z',
        }),
      ),
    );
    const deps = { url: 'https://site.test', token: 'fictif', fetch: http as typeof fetch };
    const date = new Date('2026-11-04T09:00:00Z');
    await Promise.all([
      tournerBrouillons(t.app.db, deps, date),
      tournerBrouillons(t.app.db, deps, date),
    ]);
    await tournerBrouillons(t.app.db, deps, new Date('2026-11-05T09:00:00Z'));
    const { campagnes, brouillons } = await withInstance(t.app.db, instance.id, async (tx) => ({
      campagnes: await tx.select().from(prospectionCampagnes),
      brouillons: await tx.select().from(prospectionBrouillons),
    }));
    expect(campagnes).toHaveLength(1);
    expect(campagnes[0]?.statut).toBe('redaction');
    expect(brouillons).toHaveLength(2);
    expect(new Set(brouillons.map((b) => b.lienVma)).size).toBe(2);
    expect(brouillons.every((b) => b.consigne?.includes('skill'))).toBe(true);
    expect(http).toHaveBeenCalledTimes(2);
    expect((await lireRoutineBrouillons(t.app.db, instance.id)).bilan).toContain('0 brouillon');
  } finally {
    await t.drop();
  }
});
