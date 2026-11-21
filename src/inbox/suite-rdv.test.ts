import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { fabrique } from '../../test/transfert.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import type { DossierRdv, SuiteAnnoncee } from './schema.js';
import { construireSuite, suiteAnnonceeSchema } from './suite-rdv.js';

const H = 3_600_000;
const DEBUT = new Date('2026-12-04T14:00:00Z');

describe('Inbox : la suite déduite du compte rendu', () => {
  let t: TestApp;
  let n = 0;

  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(async () => {
    await t.drop();
  });

  const f = () => fabrique(t);
  const monde = async (type: 'propre' | 'mandat' = 'propre') => {
    const i = await createInstance(t.owner.db, { slug: `suite-${++n}`, nom: `S${n}`, type });
    const ent = await f().entreprise(i, 'Entreprise Fictive');
    const contact = await f().insere(i, 'contacts', 'nom, source, entreprise_id', [
      'Camille Fictive',
      'natif',
      ent,
    ]);
    const dossier: DossierRdv = {
      sessionVisioId: 's',
      sourceRdvEventId: 'ev-source',
      rdv: null,
      rdvCertain: false,
      candidats: [],
      interlocuteurs: [
        {
          contactId: contact,
          nom: 'Camille Fictive',
          entreprise: 'Entreprise Fictive',
          principal: true,
        },
      ],
    };
    return { i, ent, contact, dossier };
  };
  const suite = (i: Instance, dossier: DossierRdv, annoncee: SuiteAnnoncee) =>
    withInstance(t.app.db, i.id, (tx) => construireSuite(tx, { instance: i, annoncee, dossier }));
  const rdvAgenda = (i: Instance, decalageH: number, o: { statut?: string } = {}) =>
    f().insere(i, 'rendez_vous', 'event_id, titre, debut, fin, participants, statut, source', [
      `ev-${++n}`,
      'Diagnostic fictif',
      new Date(DEBUT.getTime() + decalageH * H).toISOString(),
      new Date(DEBUT.getTime() + (decalageH + 1) * H).toISOString(),
      '[]',
      o.statut ?? 'rdv',
      'natif',
    ]);

  it('accepte un horaire avec décalage horaire et le ramène en UTC', () => {
    const lu = suiteAnnonceeSchema.parse({
      rdv: { titre: 'Diagnostic', debut: '2026-12-04T15:00:00+01:00', certain: true },
    });
    expect(lu.rdv?.debut).toBe('2026-12-04T14:00:00.000Z');
  });

  it('rien d’annoncé : aucune ligne', async () => {
    const { i, dossier } = await monde();
    expect(await suite(i, dossier, {})).toEqual([]);
  });

  it('diagnostic annoncé avec certitude : ligne cochée, nommée d’après l’entreprise', async () => {
    const { i, dossier } = await monde();
    expect(await suite(i, dossier, { diagnostic: { certain: true } })).toEqual([
      { genre: 'diagnostic', nom: 'Diagnostic – Entreprise Fictive', coche: true, existant: null },
    ]);
  });

  it('diagnostic incertain : ligne décochée', async () => {
    const { i, dossier } = await monde();
    const [l] = await suite(i, dossier, { diagnostic: { certain: false } });
    expect(l).toMatchObject({ genre: 'diagnostic', coche: false });
  });

  it('diagnostic : jamais proposé hors de l’espace SIMATIS (module absent)', async () => {
    const { i, dossier } = await monde('mandat');
    expect(await suite(i, dossier, { diagnostic: { certain: true } })).toEqual([]);
  });

  it('diagnostic déjà ouvert pour l’entreprise : signalé, décoché, pas de doublon', async () => {
    const { i, ent, dossier } = await monde();
    const existant = await f().insere(i, 'diagnostic_projets', 'nom, activite, entreprise_id', [
      'Diagnostic ancien',
      'services',
      ent,
    ]);
    const [l] = await suite(i, dossier, { diagnostic: { certain: true } });
    expect(l).toMatchObject({
      genre: 'diagnostic',
      coche: false,
      existant: { id: existant, nom: 'Diagnostic ancien' },
    });
  });

  it('rendez-vous annoncé et absent de l’agenda : ligne cochable', async () => {
    const { i, dossier } = await monde();
    const annoncee = { rdv: { titre: 'Diagnostic', debut: DEBUT.toISOString(), certain: true } };
    expect(await suite(i, dossier, annoncee)).toEqual([
      {
        genre: 'rdv',
        titre: 'Diagnostic',
        debut: DEBUT.toISOString(),
        coche: true,
        dejaAgenda: null,
      },
    ]);
  });

  it('rendez-vous déjà dans l’agenda à la même heure : rien à créer', async () => {
    const { i, dossier } = await monde();
    await rdvAgenda(i, 1);
    const [l] = await suite(i, dossier, {
      rdv: { titre: 'Diagnostic', debut: DEBUT.toISOString(), certain: true },
    });
    expect(l).toMatchObject({
      genre: 'rdv',
      coche: false,
      dejaAgenda: { titre: 'Diagnostic fictif' },
    });
  });

  it('un rendez-vous écarté ou lointain ne compte pas comme déjà prévu', async () => {
    const { i, dossier } = await monde();
    await rdvAgenda(i, 0, { statut: 'ignore' });
    await rdvAgenda(i, 30);
    const [l] = await suite(i, dossier, {
      rdv: { titre: 'Diagnostic', debut: DEBUT.toISOString(), certain: true },
    });
    expect(l).toMatchObject({ genre: 'rdv', coche: true, dejaAgenda: null });
  });

  it('relance : cochée si dite clairement, décochée sinon, avec son échéance', async () => {
    const { i, dossier } = await monde();
    const r = { titre: 'Relancer Camille', echeance: '2026-12-18' };
    expect(await suite(i, dossier, { relance: { ...r, certain: true } })).toEqual([
      { genre: 'relance', ...r, coche: true },
    ]);
    expect(await suite(i, dossier, { relance: { ...r, certain: false } })).toEqual([
      { genre: 'relance', ...r, coche: false },
    ]);
  });
});
