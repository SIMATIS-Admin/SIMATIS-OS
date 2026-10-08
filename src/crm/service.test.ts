import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { configureConnexion } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import fixtures from '../demo/fixtures.json' with { type: 'json' };
import { parisDay, seedDemoIfEmpty } from '../demo/seed.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import {
  createContact,
  createEntreprise,
  CrmIndisponible,
  getContact,
  getEntreprise,
  searchContacts,
  searchEntreprises,
} from './service.js';

describe('CRM objects', () => {
  let t: TestApp;
  let simatis: Instance;
  let helioval: Instance;
  let aquaterra: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    const all = await listInstances(t.owner.db);
    const find = (slug: string) => {
      const i = all.find((x) => x.slug === slug);
      if (!i) throw new Error(slug);
      return i;
    };
    simatis = find('simatis');
    helioval = find('helioval');
    aquaterra = find('aquaterra');
  });

  afterAll(async () => {
    await t.drop();
  });

  it('loads the fictive deals and tasks of the mockup', async () => {
    const count = async (table: string) =>
      (await t.owner.pool.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]
        ?.n;
    expect(await count('opportunites')).toBe(
      fixtures.reduce((n, f) => n + f.opportunites.length, 0),
    );
    expect(await count('taches')).toBe(fixtures.reduce((n, f) => n + f.taches.length, 0));
  });

  it('finds « Plasturgie Mornand » with « plast », with its open deals', async () => {
    const rows = await searchEntreprises(t.app.db, simatis.id, 'plast');
    expect(rows.map((r) => r.nom)).toEqual(['Plasturgie Mornand']);
    expect(rows[0]).toMatchObject({ nbContacts: 1 });
    expect(rows[0]?.oppsOuvertes).toBeGreaterThanOrEqual(0);
  });

  it('shows a company sheet with its contacts and deals', async () => {
    const [morvan] = await searchEntreprises(t.app.db, simatis.id, 'Ateliers Morvan');
    const fiche = await getEntreprise(t.app.db, simatis.id, morvan?.id ?? '');
    expect(fiche?.nom).toBe('Ateliers Morvan');
    expect(fiche?.contacts.map((c) => c.nom)).toEqual(['Hélène Morvan']);
    expect(fiche?.opportunites.map((o) => o.titre)).toContain('Direction commerciale partagée');
  });

  it('shows a contact sheet with company, deals and open tasks', async () => {
    const [helene] = await searchContacts(t.app.db, simatis.id, 'h.morvan');
    const fiche = await getContact(t.app.db, simatis.id, helene?.id ?? '');
    expect(fiche?.entreprise?.nom).toBe('Ateliers Morvan');
    expect(fiche?.opportunites.length).toBeGreaterThan(0);
    expect(fiche?.taches.every((x) => x.titre.length > 0)).toBe(true);
  });

  it('never returns a sheet from another instance', async () => {
    const [morvan] = await searchEntreprises(t.app.db, simatis.id, 'Ateliers Morvan');
    expect(await getEntreprise(t.app.db, helioval.id, morvan?.id ?? '')).toBeNull();
  });

  it('creates native records without source id, and journals them', async () => {
    const e = await createEntreprise(t.app.db, aquaterra.id, { nom: 'Serres du Vercors' });
    expect(e).toMatchObject({ source: 'natif', sourceId: null, instanceId: aquaterra.id });
    const c = await createContact(t.app.db, aquaterra.id, {
      nom: 'Inès Faure',
      email: 'i.faure@serres-vercors.example',
      entrepriseId: e.id,
    });
    expect(c).toMatchObject({ entrepriseId: e.id, source: 'natif' });
    const { rows } = await t.owner.pool.query<{ action: string }>(
      'select action from journal where instance_id = $1 order by id desc limit 2',
      [aquaterra.id],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'Contact créé : Inès Faure',
      'Entreprise créée : Serres du Vercors',
    ]);
  });

  it('refuses to attach a contact to a company of another instance', async () => {
    const [morvan] = await searchEntreprises(t.app.db, simatis.id, 'Ateliers Morvan');
    await expect(
      createContact(t.app.db, aquaterra.id, { nom: 'X', entrepriseId: morvan?.id }),
    ).rejects.toThrow(/inconnue/);
  });

  it('refuses a local creation while the instance CRM cannot receive it', async () => {
    await withInstance(t.app.db, helioval.id, (tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'deux_sens' },
      }),
    );
    await expect(
      createEntreprise(t.app.db, helioval.id, { nom: 'Nouvelle' }),
    ).rejects.toBeInstanceOf(CrmIndisponible);
  });

  it('computes Paris calendar days around midnight UTC', () => {
    // 22:30 UTC on 7 October is already 8 October in Paris (UTC+2).
    expect(parisDay(0, new Date('2026-10-07T22:30:00Z'))).toBe('2026-10-08');
    expect(parisDay(-1, new Date('2026-10-07T22:30:00Z'))).toBe('2026-10-07');
  });
});
