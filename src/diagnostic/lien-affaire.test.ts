import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { getFiche } from '../crm/fiches.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { rendezVousCapitalisables } from './capitalisation.js';
import { createProjet } from './service.js';

describe('Diagnostic relié à une affaire', () => {
  let t: TestApp;
  let simatis: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-lien-affaire',
      nom: 'SIMATIS',
      type: 'propre',
    });
  });
  afterAll(async () => {
    await t.drop();
  });

  const affaire = async (titre: string) =>
    (
      await t.owner.pool.query<{ id: string }>(
        "insert into opportunites (instance_id, titre, etape) values ($1, $2, 'detection') returning id",
        [simatis.id, titre],
      )
    ).rows[0]!.id;

  it('la fiche de l’affaire liste ses diagnostics, pas ceux d’une autre affaire', async () => {
    const a1 = await affaire('Affaire A');
    const a2 = await affaire('Affaire B');
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Diagnostic Fictif A',
      activite: 'services',
      opportuniteId: a1,
    });
    await createProjet(t.app.db, simatis, {
      nom: 'Diagnostic Fictif B',
      activite: 'services',
      opportuniteId: a2,
    });
    const fiche = await getFiche(t.app.db, simatis, 'affaire', a1);
    expect(fiche?.diagnostics?.map((d) => d.id)).toEqual([p.id]);
  });

  it('la capitalisation retrouve le compte rendu rangé sur l’affaire choisie, sans entreprise ni contact', async () => {
    const choisie = await affaire('Affaire choisie');
    const autre = await affaire('Autre affaire');
    const rdv = async (eventId: string, opportuniteId: string) => {
      const { rows } = await t.owner.pool.query<{ id: string }>(
        `insert into rendez_vous (instance_id, event_id, titre, debut, statut, compte_rendu, compte_rendu_at)
         values ($1, $2, $2, now(), 'rdv', 'Compte rendu fictif', now()) returning id`,
        [simatis.id, eventId],
      );
      await t.owner.pool.query(
        'insert into rdv_affaires (instance_id, rendez_vous_id, opportunite_id) values ($1, $2, $3)',
        [simatis.id, rows[0]!.id, opportuniteId],
      );
      return rows[0]!.id;
    };
    const attendu = await rdv('rdv-choisie', choisie);
    await rdv('rdv-autre', autre);
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Diagnostic Fictif C',
      activite: 'services',
      opportuniteId: choisie,
    });
    const liste = await rendezVousCapitalisables(t.app.db, simatis, p.id);
    expect(liste.map((r) => r.id)).toEqual([attendu]);
  });
});
