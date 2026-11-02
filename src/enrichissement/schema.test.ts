import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { insererFiche } from '../../test/fiche-base.js';
import { eq } from 'drizzle-orm';
import { baseVivante } from '../base-vivante/schema.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { enrichissementLignes, enrichissementSuggestions, enrichissementTaches } from './schema.js';

describe('tables de l’enrichissement', () => {
  let t: TestApp;
  let a: string;
  let b: string;
  let ficheId: string;
  let tacheId: string;

  beforeAll(async () => {
    t = await setupTestApp();
    a = (await createInstance(t.owner.db, { slug: 'a-fictive', nom: 'A fictive', type: 'mandat' }))
      .id;
    b = (await createInstance(t.owner.db, { slug: 'b-fictive', nom: 'B fictive', type: 'mandat' }))
      .id;
    ficheId = await insererFiche(t.owner.db, {
      instanceId: a,
      zone: 'a_enrichir',
      entreprise: 'Atelier Fictif',
      nom: '',
      provenance: 'test',
    });
    await withInstance(t.app.db, a, async (tx) => {
      const [tache] = await tx
        .insert(enrichissementTaches)
        .values({
          instanceId: a,
          type: 'contacts',
          profil: ['dirigeant'],
          maxParEntreprise: 2,
          etat: 'en_cours',
        })
        .returning();
      tacheId = tache!.id;
      await tx
        .insert(enrichissementLignes)
        .values({ instanceId: a, tacheId, ficheId, etat: 'attente' });
      await tx.insert(enrichissementSuggestions).values({
        instanceId: a,
        tacheId,
        ficheId,
        nom: 'Martin',
        confiance: 'haute',
        etat: 'a_valider',
      });
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  it('une suggestion de l’instance A est invisible depuis l’instance B', async () => {
    const vuesA = await withInstance(t.app.db, a, (tx) =>
      tx.select().from(enrichissementSuggestions),
    );
    const vuesB = await withInstance(t.app.db, b, (tx) =>
      tx.select().from(enrichissementSuggestions),
    );
    expect(vuesA).toHaveLength(1);
    expect(vuesB).toHaveLength(0);
    expect(
      await withInstance(t.app.db, b, (tx) => tx.select().from(enrichissementTaches)),
    ).toHaveLength(0);
  });

  it('supprimer la fiche supprime ses lignes et ses suggestions', async () => {
    await t.owner.db.delete(baseVivante).where(eq(baseVivante.id, ficheId));
    expect(await t.owner.db.select().from(enrichissementLignes)).toHaveLength(0);
    expect(await t.owner.db.select().from(enrichissementSuggestions)).toHaveLength(0);
  });
});
