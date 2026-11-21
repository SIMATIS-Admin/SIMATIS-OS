import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { fabrique } from '../../test/transfert.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { construireDossier } from './dossier-rdv.js';

const H = 3_600_000;

describe('Inbox : dossier de rendez-vous', () => {
  let t: TestApp;
  let b: Instance;
  let n = 0;
  const debut = new Date('2026-11-20T10:00:00Z');

  beforeAll(async () => {
    t = await setupTestApp();
    b = await createInstance(t.owner.db, { slug: 'dos-b', nom: 'B', type: 'mandat' });
  });
  afterAll(async () => {
    await t.drop();
  });

  const f = () => fabrique(t);
  // Rendez-vous de l'agenda (ou, avec `source`, celui d'une visio lancée hors agenda).
  const rdv = (
    i: Instance,
    titre: string,
    o: {
      decalageH?: number;
      participants?: string[];
      statut?: string;
      eventId?: string;
      source?: string;
    } = {},
  ) =>
    f().insere(i, 'rendez_vous', 'event_id, titre, debut, fin, participants, statut, source', [
      o.eventId ?? `ev-${++n}`,
      titre,
      new Date(debut.getTime() + (o.decalageH ?? 0) * H).toISOString(),
      new Date(debut.getTime() + (o.decalageH ?? 0) * H + H).toISOString(),
      JSON.stringify(o.participants ?? []),
      o.statut ?? 'rdv',
      o.source ?? 'natif',
    ]);
  const libre = (i: Instance) =>
    rdv(i, 'Enregistrement fictif', { eventId: `os:${++n}`, source: 'visio-libre' });
  const dossier = (i: Instance, rdvId: string, participants: string[] = []) =>
    withInstance(t.app.db, i.id, (tx) =>
      construireDossier(tx, { sessionVisioId: 'sess-1', rdvId, debutAt: debut, participants }),
    );

  it('un rendez-vous de l’agenda proche et seul devient le rendez-vous certain', async () => {
    const i = await createInstance(t.owner.db, { slug: 'dos-1', nom: 'U1', type: 'mandat' });
    await rdv(i, 'Diagnostic fictif', { decalageH: 0.5, eventId: 'ev-seul' });
    const d = await dossier(i, await libre(i));
    expect(d.rdv?.eventId).toBe('ev-seul');
    expect(d.rdvCertain).toBe(true);
    expect(d.candidats).toEqual([]);
    expect(d.sessionVisioId).toBe('sess-1');
  });

  it('deux rendez-vous proches sans invité commun : rien de pré-choisi', async () => {
    const i = await createInstance(t.owner.db, { slug: 'dos-2', nom: 'U2', type: 'mandat' });
    await rdv(i, 'Premier fictif', { decalageH: 0.5 });
    await rdv(i, 'Second fictif', { decalageH: -1 });
    const d = await dossier(i, await libre(i));
    expect(d.rdv).toBeNull();
    expect(d.rdvCertain).toBe(false);
    expect(d.candidats).toHaveLength(2);
  });

  it('deux proches dont un partage un invité : celui-là est certain', async () => {
    const i = await createInstance(t.owner.db, { slug: 'dos-3', nom: 'U3', type: 'mandat' });
    await rdv(i, 'Autre fictif', { decalageH: 0.5, eventId: 'ev-autre' });
    await rdv(i, 'Le bon', { decalageH: 1, eventId: 'ev-bon', participants: ['Zoe@exemple.test'] });
    const d = await dossier(i, await libre(i), ['zoe@exemple.test']);
    expect(d.rdv?.eventId).toBe('ev-bon');
    expect(d.rdvCertain).toBe(true);
  });

  it('les rendez-vous « ignore » et « os: » ne sont jamais candidats', async () => {
    const i = await createInstance(t.owner.db, { slug: 'dos-4', nom: 'U4', type: 'mandat' });
    await rdv(i, 'Écarté fictif', { statut: 'ignore' });
    await rdv(i, 'Créé dans l’OS', { eventId: 'os:autre' });
    const d = await dossier(i, await libre(i));
    expect(d.rdv).toBeNull();
    expect(d.candidats).toEqual([]);
  });

  it('l’interlocuteur est le contact lié au rendez-vous retenu, avec son entreprise', async () => {
    const i = await createInstance(t.owner.db, { slug: 'dos-5', nom: 'U5', type: 'mandat' });
    const ent = await f().entreprise(i, 'Entreprise Fictive');
    const contact = await f().insere(i, 'contacts', 'nom, source, entreprise_id', [
      'Camille Fictive',
      'natif',
      ent,
    ]);
    const cible = await rdv(i, 'Diagnostic fictif', { eventId: 'ev-lie' });
    await f().lierRdvContact(i, cible, contact);
    const d = await dossier(i, await libre(i));
    expect(d.interlocuteurs).toEqual([
      {
        contactId: contact,
        nom: 'Camille Fictive',
        entreprise: 'Entreprise Fictive',
        principal: true,
      },
    ]);
  });

  it('à défaut de lien, l’adresse d’un invité est reconnue, casse ignorée, sans doublon', async () => {
    const i = await createInstance(t.owner.db, { slug: 'dos-6', nom: 'U6', type: 'mandat' });
    const contact = await f().insere(i, 'contacts', 'nom, source, email', [
      'Alex Fictif',
      'natif',
      'Alex@Exemple.test',
    ]);
    // L'adresse principale est déjà recopiée dans contact_emails par la base : les deux tables la contiennent.
    const d = await dossier(i, await libre(i), ['ALEX@exemple.test']);
    expect(d.interlocuteurs.map((x) => x.contactId)).toEqual([contact]);
    expect(d.interlocuteurs[0]?.principal).toBe(true);
  });

  it('une adresse connue seulement dans contact_emails est reconnue', async () => {
    const i = await createInstance(t.owner.db, { slug: 'dos-7', nom: 'U7', type: 'mandat' });
    const contact = await f().contact(i, 'Robin Fictif');
    await f().insere(i, 'contact_emails', 'contact_id, email, principal', [
      contact,
      'robin@exemple.test',
      false,
    ]);
    const d = await dossier(i, await libre(i), ['robin@exemple.test']);
    expect(d.interlocuteurs.map((x) => x.contactId)).toEqual([contact]);
  });

  it('aucun participant ni candidat : dossier vide', async () => {
    const i = await createInstance(t.owner.db, { slug: 'dos-8', nom: 'U8', type: 'mandat' });
    const d = await dossier(i, await libre(i));
    expect(d).toMatchObject({ rdv: null, rdvCertain: false, candidats: [], interlocuteurs: [] });
  });

  it('un contact d’une autre instance n’est jamais reconnu', async () => {
    await f().insere(b, 'contacts', 'nom, source, email', [
      'Hors Instance',
      'natif',
      'hors@exemple.test',
    ]);
    const i = await createInstance(t.owner.db, { slug: 'dos-9', nom: 'U9', type: 'mandat' });
    const d = await dossier(i, await libre(i), ['hors@exemple.test']);
    expect(d.interlocuteurs).toEqual([]);
  });

  it('un rendez-vous de l’agenda enregistré directement est lui-même le rendez-vous certain', async () => {
    const i = await createInstance(t.owner.db, { slug: 'dos-10', nom: 'U10', type: 'mandat' });
    const direct = await rdv(i, 'Visio directe', { eventId: 'ev-direct' });
    await rdv(i, 'Voisin fictif', { decalageH: 0.5 });
    const d = await dossier(i, direct);
    expect(d.rdv?.eventId).toBe('ev-direct');
    expect(d.rdvCertain).toBe(true);
    expect(d.sourceRdvEventId).toBe('ev-direct');
  });
});
