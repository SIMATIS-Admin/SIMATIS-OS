import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import type { WriteOp } from '../connexions/types.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { deposerSujet } from './depot.js';
import { listInbox, SujetRefuse, envoyerLivreBlanc } from './service.js';

const envoyes: WriteOp[] = [];
registerConnector({
  fournisseur: 'messagerie-fictive',
  sync: () => Promise.resolve({ lus: 0, crees: 0, maj: 0, erreurs: [] }),
  write: (ctx, op) => {
    if (ctx.reglages.echouer === true) return Promise.reject(new Error('messagerie en panne'));
    if (ctx.reel) envoyes.push(op);
    return Promise.resolve({ simulation: !ctx.reel });
  },
});

const RESUME = 'Contact : Jeanne DUPONT, Gérante\nEmail : jeanne@exemple.test\nMessage :\nBonjour.';

describe('Envoi du livre blanc depuis l’Inbox', () => {
  let t: TestApp;
  let reel: Instance;
  let simule: Instance;
  let sansMessagerie: Instance;
  let casse: Instance;

  const deposer = (i: Instance, cle: string, titre = 'Demande du livre blanc — Atelier (Jeanne)') =>
    withInstance(
      t.app.db,
      i.id,
      async (tx) =>
        (
          await deposerSujet(tx, {
            type: 'mail_a_repondre',
            titre,
            resume: RESUME,
            origine: 'site',
            source: 'site',
            sourceId: cle,
          })
        ).id,
    );
  const brancher = (i: Instance, reglages = {}) =>
    withInstance(t.app.db, i.id, (tx) =>
      configureConnexion(tx, { kind: 'messagerie', fournisseur: 'messagerie-fictive', reglages }),
    );
  const deps = { secretsDir: './secrets/inexistant', realWrites: true };

  beforeAll(async () => {
    t = await setupTestApp();
    reel = await createInstance(t.owner.db, {
      slug: 'lb-reel',
      nom: 'Réel',
      type: 'propre',
      config: { ecrituresReelles: true },
    });
    simule = await createInstance(t.owner.db, { slug: 'lb-simule', nom: 'Simulé', type: 'mandat' });
    sansMessagerie = await createInstance(t.owner.db, {
      slug: 'lb-sans',
      nom: 'Sans',
      type: 'mandat',
    });
    casse = await createInstance(t.owner.db, {
      slug: 'lb-casse',
      nom: 'Cassé',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    await brancher(reel);
    await brancher(simule);
    await brancher(casse, { echouer: true });
  });

  afterAll(async () => {
    await t.drop();
  });

  it('expose le destinataire sur la demande, et pas sur un autre sujet', async () => {
    await deposer(reel, 'vue-1');
    await deposer(reel, 'vue-2', 'Devis à relancer');
    const liste = await listInbox(t.app.db, reel, 'tout');
    expect(liste.find((s) => s.titre.startsWith('Demande'))?.livreBlanc).toEqual({
      email: 'jeanne@exemple.test',
      nom: 'Jeanne DUPONT',
    });
    expect(liste.find((s) => s.titre === 'Devis à relancer')?.livreBlanc).toBeNull();
  });

  it('envoie le bon livre blanc au prospect puis range l’entrée en traité', async () => {
    const id = await deposer(reel, 'envoi-reel');
    const r = await envoyerLivreBlanc(t.app.db, reel, id, 2, deps);
    expect(r).toMatchObject({ id, statut: 'traite' });
    const op = envoyes.at(-1);
    expect(op?.op).toBe('message.send');
    expect(op?.data).toMatchObject({ to: 'jeanne@exemple.test' });
    expect(String(op?.data.subject)).toContain('n° 2');
    expect(String(op?.data.html)).toContain('Bonjour Jeanne,');
  });

  it('refuse un second envoi : l’entrée est déjà traitée', async () => {
    const id = await deposer(reel, 'deux-fois');
    await envoyerLivreBlanc(t.app.db, reel, id, 1, deps);
    await expect(envoyerLivreBlanc(t.app.db, reel, id, 1, deps)).rejects.toThrow(SujetRefuse);
  });

  it('en simulation (verrou fermé), rien ne part et l’entrée reste à traiter', async () => {
    const id = await deposer(simule, 'simule');
    const avant = envoyes.length;
    const r = await envoyerLivreBlanc(t.app.db, simule, id, 1, deps);
    expect(r).toMatchObject({ simulation: true });
    expect(envoyes).toHaveLength(avant);
    const [s] = await listInbox(t.app.db, simule, 'tout');
    expect(s?.statut).toBe('a_traiter');
  });

  it('dit pourquoi l’envoi est impossible, sans ranger l’entrée', async () => {
    const sans = await deposer(sansMessagerie, 'sans');
    await expect(envoyerLivreBlanc(t.app.db, sansMessagerie, sans, 1, deps)).rejects.toThrow(
      /Envoi impossible/,
    );
    const panne = await deposer(casse, 'panne');
    await expect(envoyerLivreBlanc(t.app.db, casse, panne, 1, deps)).rejects.toThrow(
      /messagerie en panne/,
    );
    expect((await listInbox(t.app.db, casse, 'tout'))[0]?.statut).toBe('a_traiter');
  });

  it('refuse une entrée qui n’est pas une demande de livre blanc, et ignore un id inconnu', async () => {
    const autre = await deposer(reel, 'autre', 'Devis à relancer');
    await expect(envoyerLivreBlanc(t.app.db, reel, autre, 1, deps)).rejects.toThrow(/adresse/);
    expect(
      await envoyerLivreBlanc(t.app.db, reel, '00000000-0000-4000-8000-000000000000', 1, deps),
    ).toBeNull();
  });
});
