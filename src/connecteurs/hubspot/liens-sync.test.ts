import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../../test/database.js';
import { demoPortal, fakePortal } from '../../../test/hubspot-portal.js';
import { configureConnexion, registerConnector, syncConnexion } from '../../connexions/service.js';
import { withInstance } from '../../db/context.js';
import type { Instance } from '../../instances/schema.js';
import { createInstance } from '../../instances/service.js';
import { hubspotConnector } from './index.js';

describe('Synchronisation des liens multiples', () => {
  let t: TestApp;
  let a: Instance;
  let secretsDir: string;
  const data = demoPortal();
  const portal = fakePortal(data);
  const deps = () => ({ secretsDir, realWrites: false });

  const id = async (table: string, sourceId: string) =>
    (
      await t.owner.pool.query<{ id: string }>(
        `select id from ${table} where instance_id = $1 and source_id = $2`,
        [a.id, sourceId],
      )
    ).rows[0]?.id as string;
  // Linked records as « owner source id -> [target source id, principal?] ».
  const liens = async (
    link: string,
    ownerTable: string,
    ownerCol: string,
    targetTable: string,
    targetCol: string,
  ) => {
    const { rows } = await t.owner.pool.query<{
      o: string;
      c: string;
      principal: boolean;
      source: string;
    }>(
      `select o.source_id as o, c.source_id as c, l.principal, l.source
       from ${link} l join ${ownerTable} o on o.id = l.${ownerCol} join ${targetTable} c on c.id = l.${targetCol}
       where l.instance_id = $1 order by o.source_id, l.created_at, c.source_id`,
      [a.id],
    );
    return rows.map(
      (r) => `${r.o}>${r.c}${r.principal ? '*' : ''}${r.source === 'natif' ? ' (os)' : ''}`,
    );
  };
  const contactsDesAffaires = () =>
    liens('affaire_contacts', 'opportunites', 'opportunite_id', 'contacts', 'contact_id');
  const entreprisesDesAffaires = () =>
    liens('affaire_entreprises', 'opportunites', 'opportunite_id', 'entreprises', 'entreprise_id');
  const entreprisesDesContacts = () =>
    liens('contact_entreprises', 'contacts', 'contact_id', 'entreprises', 'entreprise_id');

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'liens-sync', nom: 'Liens', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-liens-sync-'));
    await writeFile(path.join(secretsDir, 'liens-sync.env'), 'HUBSPOT_TOKEN=pat-eu1-fictif-0000\n');
    registerConnector(hubspotConnector({ fetch: portal.fetch, sleep: () => Promise.resolve() }));
    await withInstance(t.app.db, a.id, (tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'lecture' },
      }),
    );
  });

  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it('copie toutes les associations, la première (ou l’entreprise associée) étant principale', async () => {
    data.associations['deals->contacts'] = { '301': ['201', '202'], '302': '202' };
    data.associations['deals->companies'] = { '301': ['101', '103'], '302': '102', '303': '103' };
    data.associations['contacts->companies'] = { '201': ['103', '101'], '202': '102' };
    await syncConnexion(t.app.db, a, 'crm', deps());

    expect(await contactsDesAffaires()).toEqual(['301>201*', '301>202', '302>202*']);
    expect(await entreprisesDesAffaires()).toEqual(['301>101*', '301>103', '302>102*', '303>103*']);
    // Contact 201: HubSpot's associated company (101) is the primary, not the first listed.
    expect(await entreprisesDesContacts()).toEqual(['201>101*', '201>103', '202>102*']);
    expect(
      (
        await t.owner.pool.query('select contact_id from opportunites where id = $1', [
          await id('opportunites', '301'),
        ])
      ).rows[0],
    ).toEqual({ contact_id: await id('contacts', '201') });
  });

  it('retire une association disparue, promeut la suivante et garde les liens faits dans l’OS', async () => {
    await t.owner.pool.query(
      `insert into affaire_contacts (instance_id, opportunite_id, contact_id, source, principal)
       values ($1, $2, $3, 'natif', true)`,
      [a.id, await id('opportunites', '303'), await id('contacts', '201')],
    );
    data.associations['deals->contacts'] = { '301': '202', '302': '202' };
    data.associations['deals->companies'] = { '301': '103', '302': '102', '303': '103' };
    for (const d of data.deals)
      if (d.id === '301') d.properties.hs_lastmodifieddate = new Date().toISOString();
    await syncConnexion(t.app.db, a, 'crm', deps());

    expect(await contactsDesAffaires()).toEqual(['301>202*', '302>202*', '303>201* (os)']);
    expect(await entreprisesDesAffaires()).toEqual(['301>103*', '302>102*', '303>103*']);
    expect(
      (
        await t.owner.pool.query('select contact_id from opportunites where id = $1', [
          await id('opportunites', '301'),
        ])
      ).rows[0],
    ).toEqual({ contact_id: await id('contacts', '202') });
  });

  it('laisse une affaire sans association sans lien', async () => {
    data.associations['deals->contacts'] = { '302': '202' };
    for (const d of data.deals)
      if (d.id === '301') d.properties.hs_lastmodifieddate = new Date().toISOString();
    await syncConnexion(t.app.db, a, 'crm', deps());
    expect(await contactsDesAffaires()).toEqual(['302>202*', '303>201* (os)']);
    expect(
      (
        await t.owner.pool.query('select contact_id from opportunites where id = $1', [
          await id('opportunites', '301'),
        ])
      ).rows[0],
    ).toEqual({ contact_id: null });
  });
});
