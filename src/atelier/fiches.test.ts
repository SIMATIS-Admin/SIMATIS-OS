import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { getFiche } from '../crm/fiches.js';
import type { Instance } from '../instances/schema.js';
import { createInstance, setModule } from '../instances/service.js';
import { createAtelier } from './service.js';

describe('Ateliers dans les fiches', () => {
  let t: TestApp;
  let actif: Instance;
  let sans: Instance;
  let entrepriseId: string;
  let contactId: string;

  const ligne = async (i: Instance, table: string, colonnes: string, valeurs: unknown[]) =>
    (
      await t.owner.pool.query<{ id: string }>(
        `insert into ${table} (instance_id, ${colonnes}) values ($1, ${valeurs.map((_, n) => `$${n + 2}`).join(', ')}) returning id`,
        [i.id, ...valeurs],
      )
    ).rows[0]!.id;

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'atl-fiches', nom: 'A', type: 'propre' });
    actif = await setModule(t.owner.db, 'atl-fiches', 'atelier', true);
    sans = await createInstance(t.owner.db, { slug: 'atl-fiches-s', nom: 'B', type: 'propre' });
    entrepriseId = await ligne(actif, 'entreprises', 'nom', ['Entreprise Fictive']);
    contactId = await ligne(actif, 'contacts', 'nom, entreprise_id', [
      'Dirigeant Fictif',
      entrepriseId,
    ]);
  });
  afterAll(() => t.drop());

  it('la fiche entreprise liste ses ateliers, la fiche contact ceux de son entreprise', async () => {
    const a = await createAtelier(t.app.db, actif, { entrepriseId, titre: 'Lancement fictif' });
    for (const [kind, id] of [
      ['entreprise', entrepriseId],
      ['contact', contactId],
    ] as const) {
      const f = await getFiche(t.app.db, actif, kind, id);
      expect(f?.ateliers).toHaveLength(1);
      expect(f?.ateliers?.[0]).toMatchObject({ id: a.id, titre: 'Lancement fictif', etape: 1 });
      expect(Number.isNaN(Date.parse(f!.ateliers![0]!.date))).toBe(false);
    }
  });

  it('une entreprise sans atelier a une liste vide', async () => {
    const seule = await ligne(actif, 'entreprises', 'nom', ['Sans Atelier']);
    expect((await getFiche(t.app.db, actif, 'entreprise', seule))?.ateliers).toEqual([]);
  });

  it('sans le module atelier, la fiche n’a pas de champ ateliers', async () => {
    const e = await ligne(sans, 'entreprises', 'nom', ['Chez Autre']);
    expect((await getFiche(t.app.db, sans, 'entreprise', e))?.ateliers).toBeUndefined();
  });

  it('une affaire n’a pas de champ ateliers', async () => {
    const o = await ligne(actif, 'opportunites', 'titre, etape', [
      'Affaire fictive',
      'qualification',
    ]);
    expect((await getFiche(t.app.db, actif, 'affaire', o))?.ateliers).toBeUndefined();
  });
});
