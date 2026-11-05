import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance } from '../instances/service.js';

describe('Registre des lignes importées', () => {
  let t: TestApp;
  let a = '';
  let b = '';

  beforeAll(async () => {
    t = await setupTestApp();
    a = (
      await createInstance(t.owner.db, {
        slug: 'imp-a',
        nom: 'A',
        type: 'propre',
        config: { modules: ['gestion'] },
      })
    ).id;
    b = (
      await createInstance(t.owner.db, {
        slug: 'imp-b',
        nom: 'B',
        type: 'propre',
        config: { modules: ['gestion'] },
      })
    ).id;
  });
  afterAll(async () => {
    await t.drop();
  });

  const inserer = (instance: string, cle: string) =>
    t.owner.pool.query(
      `insert into gestion_import_cles (instance_id, cle, decision) values ($1, $2, 'importee')`,
      [instance, cle],
    );

  it('refuse deux fois la même clé dans la même instance', async () => {
    await inserer(a, 'pennylane|c|2026-10-15|-2399|x|1');
    await expect(inserer(a, 'pennylane|c|2026-10-15|-2399|x|1')).rejects.toThrow();
  });

  it('autorise la même clé dans une autre instance', async () => {
    await expect(inserer(b, 'pennylane|c|2026-10-15|-2399|x|1')).resolves.toBeTruthy();
  });
});
