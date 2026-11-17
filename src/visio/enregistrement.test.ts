import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { fabrique } from '../../test/transfert.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  assemblerTranscript,
  cloturerAbandonnees,
  clore,
  finaliser,
  lireSession,
  ouvrirSession,
  poserTexte,
  recevoirMorceau,
} from './enregistrement.js';

describe('Sessions d’enregistrement de visio', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;
  let rdvA: string;
  const audio = Buffer.from('son-fictif');
  const dansA = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, a.id, fn);
  const morceau = (piste: 'moi' | 'autres', rang: number, extra: object = {}) => ({
    piste,
    rang,
    debutMs: rang * 30_000,
    mime: 'audio/webm',
    audio,
    ...extra,
  });

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'enr-a', nom: 'A', type: 'mandat' });
    b = await createInstance(t.owner.db, { slug: 'enr-b', nom: 'B', type: 'mandat' });
    rdvA = await fabrique(t).insere(a, 'rendez_vous', 'event_id, titre, statut', [
      'os:enr-1',
      'Visio fictive',
      'rdv',
    ]);
  });
  afterAll(async () => {
    await t.drop();
  });

  it('réutilise la session en cours d’un rendez-vous', async () => {
    const un = await dansA((tx) => ouvrirSession(tx, rdvA));
    const deux = await dansA((tx) => ouvrirSession(tx, rdvA));
    expect(deux.id).toBe(un.id);
    await dansA((tx) => clore(tx, un.id));
  });

  it('garde un seul exemplaire d’un morceau reçu deux fois', async () => {
    const { id } = await dansA((tx) => ouvrirSession(tx, rdvA));
    await dansA(async (tx) => {
      await recevoirMorceau(tx, id, morceau('moi', 0));
      await recevoirMorceau(tx, id, morceau('moi', 0));
    });
    const s = await dansA((tx) => lireSession(tx, id));
    expect(s?.morceaux).toHaveLength(1);
    await dansA((tx) => clore(tx, id));
  });

  it('assemble le transcript dans l’ordre du temps, morceaux reçus dans le désordre', () => {
    const texte = assemblerTranscript([
      { piste: 'autres', rang: 1, debutMs: 30_000, texte: 'Et vous ?' },
      { piste: 'moi', rang: 0, debutMs: 0, texte: 'Bonjour.' },
      { piste: 'autres', rang: 0, debutMs: 0, texte: 'Bonjour à vous.' },
      { piste: 'moi', rang: 1, debutMs: 30_000, texte: '  ' },
    ]);
    expect(texte).toBe('Moi : Bonjour.\nAutres : Bonjour à vous.\nAutres : Et vous ?');
  });

  it('ne finalise qu’une fois tous les morceaux transcrits, puis supprime le son', async () => {
    const { id } = await dansA((tx) => ouvrirSession(tx, rdvA));
    await dansA(async (tx) => {
      await recevoirMorceau(tx, id, morceau('moi', 0));
      await recevoirMorceau(tx, id, morceau('autres', 0, { texte: 'Bonjour à vous.' }));
      await clore(tx, id);
    });
    expect(await dansA((tx) => finaliser(tx, id))).toBe(false);
    await dansA((tx) => poserTexte(tx, id, 'moi', 0, 'Bonjour.'));
    expect(await dansA((tx) => finaliser(tx, id))).toBe(true);
    const s = await dansA((tx) => lireSession(tx, id));
    expect(s?.statut).toBe('transcrit');
    expect(s?.transcript).toBe('Moi : Bonjour.\nAutres : Bonjour à vous.');
    expect(s?.morceaux.every((m) => m.audio === null)).toBe(true);
  });

  it('refuse un morceau reçu après la clôture', async () => {
    const { id } = await dansA((tx) => ouvrirSession(tx, rdvA));
    await dansA((tx) => clore(tx, id));
    await expect(dansA((tx) => recevoirMorceau(tx, id, morceau('moi', 5)))).rejects.toThrow(
      /close/i,
    );
  });

  it('clôt seule une session sans activité depuis plus de dix minutes', async () => {
    const { id } = await dansA((tx) => ouvrirSession(tx, rdvA));
    const dans5 = new Date(Date.now() + 5 * 60_000);
    const dans11 = new Date(Date.now() + 11 * 60_000);
    expect(await dansA((tx) => cloturerAbandonnees(tx, dans5))).toBe(0);
    expect(await dansA((tx) => cloturerAbandonnees(tx, dans11))).toBeGreaterThanOrEqual(1);
    expect((await dansA((tx) => lireSession(tx, id)))?.statut).toBe('clos');
  });

  it('ne montre pas la session d’une instance à une autre', async () => {
    const { id } = await dansA((tx) => ouvrirSession(tx, rdvA));
    const vue = await withInstance(t.app.db, b.id, (tx) => lireSession(tx, id));
    expect(vue).toBeNull();
  });
});
