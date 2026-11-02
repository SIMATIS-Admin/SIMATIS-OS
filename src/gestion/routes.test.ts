import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';
import type { OccurrenceVue, SyntheseMois } from './service.js';

type Liste = { synthese: SyntheseMois; occurrences: OccurrenceVue[] };

describe('Routes Gestion — dépenses', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  const base = '/api/i/gest-propre/gestion/depenses';

  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    await createInstance(t.owner.db, {
      slug: 'gest-propre',
      nom: 'Mon activité',
      type: 'propre',
      config: { modules: ['gestion'] },
    });
    await createInstance(t.owner.db, {
      slug: 'gest-autre',
      nom: 'Autre',
      type: 'propre',
      config: { modules: ['gestion'] },
    });
    await createInstance(t.owner.db, { slug: 'gest-sans', nom: 'Sans module', type: 'propre' });
    await createInstance(t.owner.db, { slug: 'gest-mandat', nom: 'Mandat', type: 'mandat' });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const lister = async (mois: string, slug = 'gest-propre') =>
    (
      await app.inject({ method: 'GET', url: `/api/i/${slug}/gestion/depenses?mois=${mois}` })
    ).json<Liste>();
  const creer = (corps: object, slug = 'gest-propre') =>
    app.inject({ method: 'POST', url: `/api/i/${slug}/gestion/depenses`, payload: corps });

  it('refuse Gestion hors de « Mon activité » avec le module', async () => {
    for (const slug of ['gest-mandat', 'gest-sans']) {
      const r = await app.inject({
        method: 'GET',
        url: `/api/i/${slug}/gestion/depenses?mois=2026-11`,
      });
      expect(r.statusCode).toBe(403);
      expect(
        (
          await creer(
            { libelle: 'x', montantTtcCents: 100, statut: 'reelle', dateDebut: '2026-11-04' },
            slug,
          )
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (await app.inject({ method: 'GET', url: '/api/i/inconnue/gestion/depenses?mois=2026-11' }))
        .statusCode,
    ).toBe(404);
  });

  it('crée une dépense ponctuelle sans mandat et la compte dans son mois', async () => {
    const r = await creer({
      libelle: 'Coworking',
      montantTtcCents: 18_000,
      statut: 'reelle',
      dateDebut: '2026-11-04',
    });
    expect(r.statusCode).toBe(201);
    const l = await lister('2026-11');
    expect(l.occurrences).toHaveLength(1);
    expect(l.synthese).toMatchObject({ payeCents: 18_000, aVenirCents: 0, totalCents: 18_000 });
    expect((await lister('2026-12')).occurrences).toHaveLength(0);
  });

  it('valide la requête (montant décimal, mois invalide, mandat manquant)', async () => {
    const ok = {
      libelle: 'x',
      montantTtcCents: 100,
      statut: 'reelle',
      dateDebut: '2026-11-04',
    };
    expect((await creer({ ...ok, montantTtcCents: 12.5 })).statusCode).toBe(400);
    expect((await creer({ ...ok, libelle: ' ' })).statusCode).toBe(400);
    expect((await creer({ ...ok, dateFin: '2026-10-01' })).statusCode).toBe(400);
    expect((await creer({ ...ok, affectations: [{ cible: 'mandat' }] })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/api/i/gest-propre/gestion/depenses?mois=2026-13' }))
        .statusCode,
    ).toBe(400);
  });

  describe('récurrence', () => {
    let id: string;
    beforeAll(async () => {
      const r = await creer({
        libelle: 'Navigator',
        montantTtcCents: 12_000,
        statut: 'prevue',
        recurrence: 'mensuelle',
        dateDebut: '2027-01-10',
        refacturable: true,
        affectations: [{ cible: 'simatis' }],
      });
      id = r.json<{ id: string }>().id;
    });

    it('projette sur 12 mois, sans doublon, avec le récurrent mensuel', async () => {
      const l = await lister('2027-01');
      expect(l.occurrences).toHaveLength(1);
      expect(l.synthese.aVenirCents).toBe(12_000);
      expect(l.synthese.recurrentMensuelCents).toBe(12_000);
      expect(l.synthese.parMois12).toHaveLength(12);
      expect(l.synthese.parMois12.every((m) => m.cents === 12_000)).toBe(true);
      // Un même relevé relu deux fois ne double rien.
      expect((await lister('2027-01')).synthese.totalCents).toBe(12_000);
    });

    it('« refacturable » ne réduit pas la dépense', async () => {
      const l = await lister('2027-01');
      expect(l.occurrences[0]).toMatchObject({ refacturable: true, montantTtcCents: 12_000 });
      expect(l.synthese.totalCents).toBe(12_000);
    });

    it('modifie une occurrence seule sans toucher aux autres', async () => {
      const r = await app.inject({
        method: 'PUT',
        url: `${base}/${id}/occurrences/2027-02-10`,
        payload: { portee: 'cette', etat: 'payee', montantTtcCents: 13_500 },
      });
      expect(r.statusCode).toBe(200);
      const fev = (await lister('2027-02')).occurrences[0]!;
      expect(fev).toMatchObject({ etat: 'payee', montantTtcCents: 13_500 });
      expect((await lister('2027-03')).occurrences[0]).toMatchObject({
        etat: 'a_venir',
        montantTtcCents: 12_000,
      });
      // Marquer deux fois la même occurrence ne la duplique pas.
      await app.inject({
        method: 'PUT',
        url: `${base}/${id}/occurrences/2027-02-10`,
        payload: { portee: 'cette', etat: 'payee', montantTtcCents: 13_500 },
      });
      expect((await lister('2027-02')).occurrences).toHaveLength(1);
    });

    it('ignore une occurrence puis la rétablit', async () => {
      await app.inject({
        method: 'PUT',
        url: `${base}/${id}/occurrences/2027-04-10`,
        payload: { etat: 'ignoree' },
      });
      expect((await lister('2027-04')).synthese.totalCents).toBe(0);
      await app.inject({ method: 'DELETE', url: `${base}/${id}/occurrences/2027-04-10` });
      expect((await lister('2027-04')).synthese.totalCents).toBe(12_000);
    });

    it('« cette occurrence et les suivantes » coupe la série et repart au nouveau montant', async () => {
      const r = await app.inject({
        method: 'PUT',
        url: `${base}/${id}/occurrences/2027-06-10`,
        payload: { portee: 'suivantes', serie: { montantTtcCents: 15_000 } },
      });
      expect(r.statusCode).toBe(200);
      expect((await lister('2027-05')).occurrences.map((o) => o.montantTtcCents)).toEqual([12_000]);
      expect((await lister('2027-06')).occurrences.map((o) => o.montantTtcCents)).toEqual([15_000]);
      expect((await lister('2027-09')).occurrences).toHaveLength(1);
    });

    it('refuse une occurrence qui n’existe pas', async () => {
      const r = await app.inject({
        method: 'PUT',
        url: `${base}/${id}/occurrences/2027-02-11`,
        payload: { etat: 'payee' },
      });
      expect(r.statusCode).toBe(400);
    });
  });

  it('une modification partielle ne réinitialise pas la récurrence', async () => {
    const r = await creer({
      libelle: 'Téléphone',
      montantTtcCents: 3_500,
      statut: 'reelle',
      recurrence: 'mensuelle',
      dateDebut: '2026-05-03',
      refacturable: true,
    });
    const id = r.json<{ id: string }>().id;
    const p = await app.inject({
      method: 'PATCH',
      url: `${base}/${id}`,
      payload: { libelle: 'Mobile' },
    });
    expect(p.json()).toMatchObject({
      libelle: 'Mobile',
      recurrence: 'mensuelle',
      refacturable: true,
    });
  });

  it('une série « déjà payée » ne compte payées que ses échéances passées', async () => {
    const r = await creer({
      libelle: 'Assurance',
      montantTtcCents: 4_000,
      statut: 'reelle',
      recurrence: 'mensuelle',
      dateDebut: '2020-01-05',
      affectations: [{ cible: 'kairos' }, { cible: 'mandat', mandat: 'alpha' }],
    });
    expect(r.statusCode).toBe(201);
    expect((await lister('2020-03')).occurrences[0]?.etat).toBe('payee');
    expect((await lister('2099-03')).occurrences[0]?.etat).toBe('a_venir');
    expect((await lister('2020-03')).occurrences[0]?.affectations).toEqual([
      { cible: 'kairos' },
      { cible: 'mandat', mandat: 'alpha' },
    ]);
  });

  it('archive sans supprimer et masque la dépense', async () => {
    const r = await creer({
      libelle: 'Abonnement test',
      montantTtcCents: 5_000,
      statut: 'reelle',
      dateDebut: '2019-06-02',
    });
    const id = r.json<{ id: string }>().id;
    expect((await lister('2019-06')).occurrences).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `${base}/${id}` })).statusCode).toBe(200);
    expect((await lister('2019-06')).occurrences).toHaveLength(0);
    expect((await app.inject({ method: 'DELETE', url: `${base}/${id}` })).statusCode).toBe(404);
  });

  it('cloisonne les dépenses entre instances', async () => {
    expect((await lister('2026-11', 'gest-autre')).occurrences).toHaveLength(0);
  });
});
