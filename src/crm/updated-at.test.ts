import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { sql, type SQL } from 'drizzle-orm';

// The partner sync reads the records changed since its last pass: updated_at must move whatever
// the path (a raw update, a link added or removed). Fictitious data only.
describe('CRM : updated_at bouge à chaque modification', () => {
  let t: TestApp;
  let instance: Instance;
  const ANCIEN = '2026-01-01T00:00:00Z';

  const q = <T extends Record<string, unknown>>(requete: SQL) =>
    withInstance(t.app.db, instance.id, async (tx) => (await tx.execute<T>(requete)).rows);
  // Table names come from the tests themselves.
  const majLe = async (table: string, id: string) => {
    const [r] = await q<{ u: string }>(
      sql`select updated_at::text as u from ${sql.raw(table)} where id = ${id}`,
    );
    return r ? new Date(r.u) : null;
  };
  const vieillir = (table: string, id: string) =>
    q(sql`update ${sql.raw(table)} set updated_at = ${ANCIEN} where id = ${id}`);
  const bouge = async (table: string, id: string) =>
    ((await majLe(table, id))?.getTime() ?? 0) > Date.parse(ANCIEN);

  let entreprise: string;
  let contact: string;
  let affaire: string;
  let rdv: string;

  beforeAll(async () => {
    t = await setupTestApp();
    instance = await createInstance(t.owner.db, {
      slug: 'client-fictif',
      nom: 'Client fictif',
      type: 'mandat',
      config: {},
    });
    const id = async (requete: SQL) => (await q<{ id: string }>(requete))[0]?.id ?? '';
    const i = instance.id;
    entreprise = await id(
      sql`insert into entreprises (instance_id, nom) values (${i}, 'Entreprise fictive') returning id`,
    );
    contact = await id(
      sql`insert into contacts (instance_id, nom) values (${i}, 'Contact Fictif') returning id`,
    );
    affaire = await id(
      sql`insert into opportunites (instance_id, titre, etape) values (${i}, 'Affaire fictive', 'qualification') returning id`,
    );
    rdv = await id(
      sql`insert into rendez_vous (instance_id, event_id, titre, statut) values (${i}, 'os:fictif', 'Rendez-vous fictif', 'rdv') returning id`,
    );
  });

  afterAll(async () => {
    await t.drop();
  });

  it('moves on an update that does not set it, keeps a value set on purpose', async () => {
    await vieillir('opportunites', affaire);
    expect(await majLe('opportunites', affaire)).toEqual(new Date(ANCIEN));
    await q(sql`update opportunites set etape = 'negociation' where id = ${affaire}`);
    expect(await bouge('opportunites', affaire)).toBe(true);
    // A no-op update changes nothing.
    await vieillir('opportunites', affaire);
    await q(sql`update opportunites set etape = 'negociation' where id = ${affaire}`);
    expect(await bouge('opportunites', affaire)).toBe(false);
  });

  it('moves the record a link is added to or removed from', async () => {
    const i = instance.id;
    await vieillir('opportunites', affaire);
    await q(
      sql`insert into affaire_contacts (instance_id, opportunite_id, contact_id, principal) values (${i}, ${affaire}, ${contact}, true)`,
    );
    expect(await bouge('opportunites', affaire)).toBe(true);

    await vieillir('contacts', contact);
    await q(
      sql`insert into contact_entreprises (instance_id, contact_id, entreprise_id, principal) values (${i}, ${contact}, ${entreprise}, true)`,
    );
    expect(await bouge('contacts', contact)).toBe(true);

    await vieillir('rendez_vous', rdv);
    await q(
      sql`insert into rdv_affaires (instance_id, rendez_vous_id, opportunite_id) values (${i}, ${rdv}, ${affaire})`,
    );
    expect(await bouge('rendez_vous', rdv)).toBe(true);

    await vieillir('opportunites', affaire);
    await q(sql`delete from affaire_contacts where opportunite_id = ${affaire}`);
    expect(await bouge('opportunites', affaire)).toBe(true);
  });

  it('moves a contact when one of its addresses changes', async () => {
    await vieillir('contacts', contact);
    await q(
      sql`insert into contact_emails (instance_id, contact_id, email) values (${instance.id}, ${contact}, 'autre@exemple.test')`,
    );
    expect(await bouge('contacts', contact)).toBe(true);
  });
});
