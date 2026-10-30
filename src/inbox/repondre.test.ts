import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Operation, Resultat } from '../cerveau/file.js';
import { RunnerInjoignable } from '../cerveau/file.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { journal } from '../journal/schema.js';
import { deposerSujet } from './depot.js';
import { sujets } from './schema.js';
import { DepotRefuse, listInbox, repondreMessagePartage, SujetRefuse } from './service.js';

const CHEMIN = 'echanges/2026-10-29-2141-christophe-fictif.md';
const reponse = { sujet: 'Re : Point fictif', corps: 'Bonjour, voici ma réponse fictive.' };

describe('Répondre à un message de l’espace partagé depuis l’Inbox', () => {
  let t: TestApp;
  let inst: Instance;

  const deposer = (
    cle: string,
    source = 'routine',
    titre = 'Répondre à Christophe : Point fictif',
  ) =>
    withInstance(
      t.app.db,
      inst.id,
      async (tx) =>
        (
          await deposerSujet(tx, {
            type: 'mail_a_repondre',
            titre,
            origine: 'messagerie',
            source,
            sourceId: cle,
          })
        ).id,
    );
  const evenements = () =>
    withInstance(t.app.db, inst.id, (tx) =>
      tx
        .select()
        .from(journal)
        .where(and(eq(journal.acteur, 'pilote'), eq(journal.instanceId, inst.id))),
    );
  const ok = (): Promise<Resultat> => Promise.resolve({ ok: true, chemin: 'echanges/reponse.md' });

  beforeAll(async () => {
    t = await setupTestApp();
    inst = await createInstance(t.owner.db, { slug: 'rep-partage', nom: 'Rép', type: 'propre' });
  });

  afterAll(async () => {
    await t.drop();
  });

  it('expose le chemin du message source, et rien sur une autre entrée', async () => {
    await deposer(`partage:${CHEMIN}`);
    await deposer('cle-quelconque', 'manuelle', 'Autre entrée');
    const liste = await listInbox(t.app.db, inst, 'tout');
    expect(liste.find((s) => s.titre.startsWith('Répondre'))?.partage).toEqual({ chemin: CHEMIN });
    expect(liste.find((s) => s.titre === 'Autre entrée')?.partage).toBeNull();
  });

  it('dépose la réponse puis range l’entrée en traité, avec une trace au journal', async () => {
    const id = await deposer(`partage:${CHEMIN}-ok`);
    const vus: Operation[] = [];
    const r = await repondreMessagePartage(t.app.db, inst, id, reponse, (op) => {
      vus.push(op);
      return ok();
    });
    expect(vus).toEqual([
      {
        espace: 'partage',
        type: 'message',
        genre: 'reponse',
        ...reponse,
        enReponseA: `${CHEMIN}-ok`,
      },
    ]);
    expect(r).toMatchObject({ id, statut: 'traite' });
    expect((await evenements()).map((e) => e.action)).toContain(
      'Réponse déposée à Christophe : Répondre à Christophe : Point fictif',
    );
  });

  it('laisse l’entrée à traiter quand l’espace partagé refuse le dépôt', async () => {
    const id = await deposer(`partage:${CHEMIN}-refus`);
    await expect(
      repondreMessagePartage(t.app.db, inst, id, reponse, () =>
        Promise.resolve({ ok: false, erreur: 'refus fictif' }),
      ),
    ).rejects.toThrow(new DepotRefuse('refus fictif'));
    const s = (await listInbox(t.app.db, inst, 'tout')).find((x) => x.id === id);
    expect(s?.statut).toBe('a_traiter');
  });

  it('dit que l’exécuteur ne répond pas, sans rien ranger', async () => {
    const id = await deposer(`partage:${CHEMIN}-muet`);
    await expect(
      repondreMessagePartage(t.app.db, inst, id, reponse, () =>
        Promise.reject(new RunnerInjoignable()),
      ),
    ).rejects.toThrow(/exécuteur du poste ne répond pas/);
    const s = (await listInbox(t.app.db, inst, 'tout')).find((x) => x.id === id);
    expect(s?.statut).toBe('a_traiter');
  });

  it('refuse une entrée déjà traitée sans rien demander à l’exécuteur', async () => {
    const id = await deposer(`partage:${CHEMIN}-deja`);
    await repondreMessagePartage(t.app.db, inst, id, reponse, ok);
    let appels = 0;
    await expect(
      repondreMessagePartage(t.app.db, inst, id, reponse, () => {
        appels++;
        return ok();
      }),
    ).rejects.toThrow(SujetRefuse);
    expect(appels).toBe(0);
  });

  it('refuse une entrée qui ne vient pas de l’espace partagé, et ignore un id inconnu', async () => {
    const autre = await deposer('cle-autre', 'routine', 'Mail à répondre');
    await expect(repondreMessagePartage(t.app.db, inst, autre, reponse, ok)).rejects.toThrow(
      /espace partagé/,
    );
    expect(
      await repondreMessagePartage(
        t.app.db,
        inst,
        '00000000-0000-4000-8000-000000000000',
        reponse,
        ok,
      ),
    ).toBeNull();
  });

  it('accepte une entrée traitée pendant l’attente, sans second marquage', async () => {
    const id = await deposer(`partage:${CHEMIN}-course`);
    const avant = (await evenements()).length;
    const r = await repondreMessagePartage(t.app.db, inst, id, reponse, async () => {
      await withInstance(t.app.db, inst.id, (tx) =>
        tx.update(sujets).set({ statut: 'traite' }).where(eq(sujets.id, id)),
      );
      return { ok: true };
    });
    expect(r).toMatchObject({ id, statut: 'traite' });
    expect((await evenements()).length).toBe(avant);
  });

  it('refuse une seconde réponse pendant que la première est en cours (double clic)', async () => {
    const id = await deposer(`partage:${CHEMIN}-double`);
    let appels = 0;
    let liberer: () => void = () => undefined;
    const lente = () => {
      appels++;
      return new Promise<Resultat>((resolve) => {
        liberer = () => resolve({ ok: true });
      });
    };
    const premiere = repondreMessagePartage(t.app.db, inst, id, reponse, lente);
    await new Promise((r) => setTimeout(r, 50));
    await expect(repondreMessagePartage(t.app.db, inst, id, reponse, lente)).rejects.toThrow(
      /déjà en cours/,
    );
    liberer();
    await premiere;
    expect(appels).toBe(1);
  });
});
