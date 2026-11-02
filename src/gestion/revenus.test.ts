import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';

type Synthese = {
  aEncaisserCertainCents: number;
  aEncaisserIncertainCents: number;
  encaisseCents: number;
  parMandat: {
    mandat: string | null;
    totalCents: number;
    aFacturerCents: number;
    parType: Record<string, number>;
  }[];
};
type Liste = {
  synthese: Synthese;
  revenus: {
    revenuId: string;
    cle: string;
    libelle: string;
    mandat: string | null;
    etat: string;
  }[];
};

describe('Routes Gestion — recettes ponctuelles', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  const base = '/api/i/rev-propre/gestion/revenus';

  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    for (const slug of ['rev-propre', 'rev-autre'])
      await createInstance(t.owner.db, {
        slug,
        nom: slug,
        type: 'propre',
        config: { modules: ['gestion'] },
      });
    await createInstance(t.owner.db, { slug: 'rev-mandat', nom: 'Mandat', type: 'mandat' });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const lister = async (mois: string, slug = 'rev-propre') =>
    (
      await app.inject({ method: 'GET', url: `/api/i/${slug}/gestion/revenus?mois=${mois}` })
    ).json<Liste>();
  const creer = (corps: object, slug = 'rev-propre') =>
    app.inject({ method: 'POST', url: `/api/i/${slug}/gestion/revenus`, payload: corps });
  const commission = {
    libelle: 'Commission fictive',
    montantHtCents: 600_000,
    date: '2026-11-20',
    mandat: 'mandat-alpha',
  };

  it('refuse hors de « Mon activité » avec le module', async () => {
    expect((await creer(commission, 'rev-mandat')).statusCode).toBe(403);
  });

  it('crée une recette unique pour un mandat, prévue par défaut, sans toucher aux dépenses', async () => {
    const r = await creer(commission);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ type: 'commission', etat: 'prevue', mandat: 'mandat-alpha' });
    const l = await lister('2026-11');
    expect(l.revenus).toHaveLength(1);
    expect(l.synthese).toMatchObject({
      aEncaisserCertainCents: 600_000,
      aEncaisserIncertainCents: 0,
      encaisseCents: 0,
    });
    const dep = await app.inject({
      method: 'GET',
      url: '/api/i/rev-propre/gestion/depenses?mois=2026-11',
    });
    expect(dep.json<{ synthese: { totalCents: number } }>().synthese.totalCents).toBe(0);
  });

  it('accepte une recette sans mandat et valide la saisie', async () => {
    expect((await creer({ ...commission, mandat: null, libelle: 'Libre' })).statusCode).toBe(201);
    expect((await creer({ ...commission, montantHtCents: 10.5 })).statusCode).toBe(400);
    expect((await creer({ ...commission, mandat: 'Pas un slug' })).statusCode).toBe(400);
    expect((await creer({ ...commission, etat: 'encaissee' })).statusCode).toBe(400);
  });

  it('distingue facturée et encaissée, l’encaissement compte à sa propre date', async () => {
    const id = (await creer({ ...commission, libelle: 'Suivie', date: '2026-12-05' })).json<{
      id: string;
    }>().id;
    const emise = await app.inject({
      method: 'PATCH',
      url: `${base}/${id}`,
      payload: { etat: 'emise', referenceFacture: 'F-FICTIVE-1' },
    });
    expect(emise.json()).toMatchObject({ etat: 'emise', referenceFacture: 'F-FICTIVE-1' });
    const sans = await app.inject({
      method: 'PATCH',
      url: `${base}/${id}`,
      payload: { etat: 'encaissee' },
    });
    expect(sans.statusCode).toBe(400);
    await app.inject({
      method: 'PATCH',
      url: `${base}/${id}`,
      payload: { etat: 'encaissee', dateEncaissement: '2027-01-12' },
    });
    expect((await lister('2026-12')).revenus).toHaveLength(0);
    expect((await lister('2027-01')).synthese).toMatchObject({
      encaisseCents: 600_000,
      aEncaisserCertainCents: 0,
    });
  });

  it('archive sans supprimer et cloisonne les instances', async () => {
    const id = (await creer({ ...commission, libelle: 'À retirer', date: '2019-03-03' })).json<{
      id: string;
    }>().id;
    expect((await lister('2019-03')).revenus).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `${base}/${id}` })).statusCode).toBe(200);
    expect((await lister('2019-03')).revenus).toHaveLength(0);
    expect((await lister('2026-11', 'rev-autre')).revenus).toHaveLength(0);
  });

  describe('Lot B : séries, certitude, par mandat, factures à émettre', () => {
    it('cumule abonnement et commission pour un mandat, sans abonnement fictif ailleurs', async () => {
      await creer({
        libelle: 'Abonnement fictif',
        type: 'abonnement',
        mandat: 'mandat-b',
        montantHtCents: 150_000,
        date: '2030-01-05',
        recurrence: 'mensuelle',
      });
      await creer({
        libelle: 'Commission fictive B',
        mandat: 'mandat-b',
        montantHtCents: 400_000,
        date: '2030-02-10',
        certitude: 'probable',
      });
      await creer({
        libelle: 'Commission seule',
        mandat: 'mandat-c',
        montantHtCents: 90_000,
        date: '2030-02-12',
      });
      const l = await lister('2030-02');
      const b = l.synthese.parMandat.find((m) => m.mandat === 'mandat-b')!;
      expect(b.parType).toEqual({ abonnement: 150_000, commission: 400_000 });
      expect(l.synthese.parMandat.find((m) => m.mandat === 'mandat-c')!.parType).toEqual({
        commission: 90_000,
      });
      // La commission probable n'est jamais comptée comme certaine.
      expect(l.synthese.aEncaisserCertainCents).toBe(240_000);
      expect(l.synthese.aEncaisserIncertainCents).toBe(400_000);
    });

    it('règle une échéance de série sans toucher aux autres, ni la dupliquer', async () => {
      const l1 = await lister('2030-03');
      const abo = l1.revenus.find((r) => r.libelle === 'Abonnement fictif')!;
      const put = (corps: object) =>
        app.inject({
          method: 'PUT',
          url: `${base}/${abo.revenuId}/occurrences/2030-03-05`,
          payload: corps,
        });
      expect((await put({ etat: 'emise', referenceFacture: 'F-FICTIVE-9' })).statusCode).toBe(200);
      expect((await put({ etat: 'encaissee' })).statusCode).toBe(400);
      expect(
        (await put({ etat: 'encaissee', dateEncaissement: '2030-04-02', montantHtCents: 149_000 }))
          .statusCode,
      ).toBe(200);
      const mars = await lister('2030-03');
      expect(mars.revenus.filter((r) => r.libelle === 'Abonnement fictif')).toHaveLength(0);
      const avril = await lister('2030-04');
      const lignes = avril.revenus.filter((r) => r.libelle === 'Abonnement fictif');
      expect(lignes.map((r) => r.etat).sort()).toEqual(['encaissee', 'prevue']);
      expect(avril.synthese.encaisseCents).toBe(149_000);
    });

    it('liste les factures à émettre : ni hypothèse, ni déjà émise', async () => {
      await creer({
        libelle: 'Hypothèse fictive',
        montantHtCents: 100_000,
        date: '2030-05-01',
        certitude: 'hypothese',
      });
      await creer({ libelle: 'À émettre fictive', montantHtCents: 80_000, date: '2030-05-02' });
      const r = await app.inject({
        method: 'GET',
        url: '/api/i/rev-propre/gestion/factures-a-emettre?jusqua=2030-05-31',
      });
      const libelles = r.json<{ libelle: string; etat: string }[]>().map((o) => o.libelle);
      expect(libelles).toContain('À émettre fictive');
      expect(libelles).not.toContain('Hypothèse fictive');
      expect(r.json<{ etat: string }[]>().every((o) => o.etat === 'prevue')).toBe(true);
    });

    it('lie une refacturation à une dépense sans jamais la réduire', async () => {
      const dep = await app.inject({
        method: 'POST',
        url: '/api/i/rev-propre/gestion/depenses',
        payload: {
          libelle: 'Outil fictif',
          montantTtcCents: 12_000,
          statut: 'prevue',
          recurrence: 'mensuelle',
          dateDebut: '2031-01-10',
          refacturable: true,
        },
      });
      const depenseId = dep.json<{ id: string }>().id;
      for (const mandat of ['mandat-b', 'mandat-c'])
        expect(
          (
            await creer({
              libelle: 'Refacturation outil',
              type: 'refacturation',
              mandat,
              montantHtCents: 4_000,
              date: '2031-01-10',
              recurrence: 'mensuelle',
              depenseId,
            })
          ).statusCode,
        ).toBe(201);
      expect(
        (await creer({ ...commission, depenseId: '11111111-1111-4111-8111-111111111111' }))
          .statusCode,
      ).toBe(400);
      const liste = await app.inject({
        method: 'GET',
        url: '/api/i/rev-propre/gestion/depenses?mois=2031-01',
      });
      const o = liste.json<{
        synthese: { totalCents: number };
        occurrences: { refacturablePrevuCents: number; refactureCents: number }[];
      }>();
      expect(o.synthese.totalCents).toBe(12_000);
      expect(o.occurrences[0]).toMatchObject({ refacturablePrevuCents: 8_000, refactureCents: 0 });
      // Facturer une des deux refacturations : refacturé réel = 4 000, dépense inchangée.
      const rev = (await lister('2031-01')).revenus.find(
        (r) => r.libelle === 'Refacturation outil',
      )!;
      await app.inject({
        method: 'PUT',
        url: `${base}/${rev.revenuId}/occurrences/2031-01-10`,
        payload: { etat: 'emise' },
      });
      const apres = (
        await app.inject({ method: 'GET', url: '/api/i/rev-propre/gestion/depenses?mois=2031-01' })
      ).json<{ occurrences: { refactureCents: number }[]; synthese: { totalCents: number } }>();
      expect(apres.occurrences[0]!.refactureCents).toBe(4_000);
      expect(apres.synthese.totalCents).toBe(12_000);
      const detail = (
        await app.inject({ method: 'GET', url: `/api/i/rev-propre/gestion/depenses/${depenseId}` })
      ).json<{ refacturations: unknown[] }>();
      expect(detail.refacturations).toHaveLength(2);
    });
  });
});
