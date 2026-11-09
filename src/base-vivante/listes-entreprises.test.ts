import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { ClientAnnuaire, EntrepriseAnnuaire } from '../annuaire/client.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { enregistrerEntreprise } from './entreprises.js';
import { integrerFiches, rattacherEntreprise } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import { registerBaseVivanteRoutes } from './routes.js';
import { listerFiches } from './service.js';
import { exporterWaalaxy } from './waalaxy.js';

type Json = Record<string, unknown>;

const annuaire = (siren: string, nom: string, ca: number | null): EntrepriseAnnuaire => ({
  siren,
  nom,
  formeJuridique: null,
  naf: '25.62B',
  categorie: 'PME',
  effectif: '20 à 49 salariés',
  creeLe: null,
  active: true,
  etablissementsOuverts: null,
  oppositionDiffusion: false,
  siret: null,
  adresse: null,
  codePostal: null,
  ville: 'CHASSIEU',
  departement: '69',
  latitude: null,
  longitude: null,
  finances: ca === null ? [] : [{ annee: 2023, ca, resultat: 1000 }],
  dirigeants: [],
});

describe('base vivante : listes d’entreprises', () => {
  let t: TestApp;
  let base: Instance;
  let autre: Instance;
  const client = {
    chercher: vi.fn<ClientAnnuaire['chercher']>(),
    parSiren: vi.fn<ClientAnnuaire['parSiren']>(),
    rechercher: vi.fn<ClientAnnuaire['rechercher']>(),
  };

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-le', nom: 'Base', type: 'propre' });
    autre = await createInstance(t.owner.db, { slug: 'bv-le-b', nom: 'Autre', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    client.parSiren
      .mockReset()
      .mockImplementation((s) =>
        Promise.resolve(s === '333333333' ? annuaire(s, 'USINE FICTIVE', null) : null),
      );
    for (const table of [
      'base_liste_entreprises',
      'base_liste_fiches',
      'base_listes',
      'base_vivante',
      'base_entreprises',
    ])
      await t.owner.pool.query(`delete from ${table}`);
  });

  const app = () => {
    const a = Fastify();
    registerBaseVivanteRoutes(a, { db: t.app.db, annuaire: client });
    return a;
  };
  const appel = async (
    a: ReturnType<typeof app>,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    slug = 'bv-le',
  ) => {
    const r = await a.inject({
      method,
      url: `/api/i/${slug}/base${url}`,
      payload: payload as Json,
    });
    return { status: r.statusCode, corps: r.json<Json>() };
  };
  // Deux entreprises de l'annuaire, la première avec deux contacts, la seconde avec un seul.
  const monter = async (instance: Instance = base) => {
    const ids = await withInstance(t.app.db, instance.id, async (tx) => {
      const res = await integrerFiches(
        tx,
        instance.id,
        (
          [
            {
              entreprise: 'Atelier Fictif',
              nom: 'Un',
              email: 'un@a.test',
              linkedin: 'https://linkedin.com/in/un',
            },
            {
              entreprise: 'Atelier Fictif',
              nom: 'Deux',
              email: 'deux@a.test',
              linkedin: 'https://linkedin.com/in/deux',
            },
            {
              entreprise: 'Bureau Fictif',
              nom: 'Trois',
              email: 'trois@b.test',
              linkedin: 'https://linkedin.com/in/trois',
            },
            { entreprise: 'Isolé Fictif', nom: 'Quatre', email: 'q@i.test' },
          ] as Brut[]
        ).map((b) => ({
          fiche: normaliserFiche(b).fiche,
          provenance: 'Sharp',
          mandat: null,
          importId: null,
          collecteLe: null,
        })),
      );
      const atelier = await enregistrerEntreprise(
        tx,
        instance.id,
        annuaire('111111111', 'ATELIER FICTIF', 425000),
      );
      const bureau = await enregistrerEntreprise(
        tx,
        instance.id,
        annuaire('222222222', 'BUREAU FICTIF', null),
      );
      await rattacherEntreprise(tx, instance.id, res[0]?.id ?? '', atelier.id);
      await rattacherEntreprise(tx, instance.id, res[2]?.id ?? '', bureau.id);
      return { atelier: atelier.id, bureau: bureau.id };
    });
    return ids;
  };
  const creer = async (a: ReturnType<typeof app>, nom: string, type?: string) =>
    (await appel(a, 'POST', '/listes', { nom, type })).corps.id as string;

  it('crée des listes de contacts (par défaut) ou d’entreprises', async () => {
    const a = app();
    const contacts = await appel(a, 'POST', '/listes', { nom: 'Contacts' });
    const entreprises = await appel(a, 'POST', '/listes', { nom: 'Cibles', type: 'entreprises' });
    expect(contacts.corps).toMatchObject({ type: 'contacts' });
    expect(entreprises.corps).toMatchObject({ type: 'entreprises', nombre: 0 });
    expect((await appel(a, 'POST', '/listes', { nom: 'X', type: 'autre' })).status).toBe(400);
    expect((await appel(a, 'GET', '')).corps.listes).toMatchObject([
      { nom: 'Cibles', type: 'entreprises' },
      { nom: 'Contacts', type: 'contacts' },
    ]);
  });

  it('liste les entreprises de la base avec leurs contacts et leur chiffre d’affaires', async () => {
    await monter();
    const a = app();
    const { corps } = await appel(a, 'GET', '/entreprises');
    expect(corps.total).toBe(2);
    expect(corps.entreprises).toMatchObject([
      {
        siren: '111111111',
        nom: 'ATELIER FICTIF',
        ville: 'CHASSIEU',
        ca: 425000,
        nbContacts: 2,
        listes: [],
      },
      { siren: '222222222', nom: 'BUREAU FICTIF', ca: null, nbContacts: 1 },
    ]);
    const recherche = await appel(a, 'GET', '/entreprises?q=bureau');
    expect(recherche.corps.total).toBe(1);
  });

  it('range des entreprises dans une liste, sans doublon, et filtre sur elle', async () => {
    const { atelier, bureau } = await monter();
    const a = app();
    const id = await creer(a, 'Cibles', 'entreprises');
    expect(
      (await appel(a, 'POST', `/listes/${id}/entreprises`, { ids: [atelier, atelier] })).corps,
    ).toEqual({
      ajoutees: 1,
    });
    expect(
      (await appel(a, 'POST', `/listes/${id}/entreprises`, { ids: [atelier, bureau] })).corps,
    ).toEqual({
      ajoutees: 1,
    });
    expect((await appel(a, 'GET', '')).corps.listes).toMatchObject([{ id, nombre: 2 }]);
    const filtre = await appel(a, 'GET', `/entreprises?liste=${id}`);
    expect(filtre.corps.total).toBe(2);
    expect((filtre.corps.entreprises as Json[])[0]?.listes).toEqual([id]);
    await appel(a, 'DELETE', `/listes/${id}/entreprises`, { ids: [bureau] });
    expect((await appel(a, 'GET', `/entreprises?liste=${id}`)).corps.total).toBe(1);
  });

  it('refuse de mélanger contacts et entreprises dans une même liste', async () => {
    const { atelier } = await monter();
    const a = app();
    const entreprises = await creer(a, 'Cibles', 'entreprises');
    const contacts = await creer(a, 'Contacts');
    const [fiche] = (await listerFiches(t.app.db, base.id)).fiches;
    expect(
      (await appel(a, 'POST', `/listes/${entreprises}/fiches`, { ids: [fiche?.id] })).status,
    ).toBe(400);
    expect(
      (await appel(a, 'POST', `/listes/${contacts}/entreprises`, { ids: [atelier] })).status,
    ).toBe(400);
  });

  it('les contacts d’une liste d’entreprises sont ceux de ces entreprises', async () => {
    const { atelier } = await monter();
    const a = app();
    const id = await creer(a, 'Cibles', 'entreprises');
    await appel(a, 'POST', `/listes/${id}/entreprises`, { ids: [atelier] });
    const noms = async (filtres = {}) =>
      (await listerFiches(t.app.db, base.id, filtres)).fiches.map((f) => f.nom).sort();
    expect(await noms({ liste: id })).toEqual(['DEUX', 'UN']);
    const export_ = await exporterWaalaxy(t.app.db, base.id, { liste: id });
    expect(export_.apercu.retenues).toBe(2);
  });

  it('supprimer une liste ou une entreprise laisse l’autre en place', async () => {
    const { atelier } = await monter();
    const a = app();
    const id = await creer(a, 'Cibles', 'entreprises');
    await appel(a, 'POST', `/listes/${id}/entreprises`, { ids: [atelier] });
    await appel(a, 'DELETE', `/listes/${id}`);
    expect((await appel(a, 'GET', '/entreprises')).corps.total).toBe(2);
    expect((await listerFiches(t.app.db, base.id)).fiches).toHaveLength(4);
  });

  it('cloisonne les entreprises par instance', async () => {
    const { atelier } = await monter();
    await monter(autre);
    const a = app();
    const id = await creer(a, 'Cibles', 'entreprises');
    const intrus = await appel(
      a,
      'POST',
      `/listes/${id}/entreprises`,
      { ids: [atelier] },
      'bv-le-b',
    );
    expect(intrus.status).toBe(404);
    const autreId = await creer(a, 'Autre liste', 'entreprises');
    expect(autreId).toBeTruthy();
    const vue = await appel(a, 'GET', '/entreprises', undefined, 'bv-le-b');
    expect(vue.corps.total).toBe(2);
    const propre = await appel(a, 'GET', '/entreprises');
    expect(propre.corps.total).toBe(2);
  });

  it('range les entreprises ajoutées par la recherche dans une liste d’entreprises', async () => {
    const a = app();
    const id = await creer(a, 'Cibles', 'entreprises');
    const res = await appel(a, 'POST', '/entreprises/ajouter', {
      sirens: ['333333333'],
      liste: id,
    });
    expect(res.corps).toMatchObject({ ajoutees: 1 });
    const filtre = await appel(a, 'GET', `/entreprises?liste=${id}`);
    expect(filtre.corps).toMatchObject({ total: 1, entreprises: [{ siren: '333333333' }] });
  });
});
