import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { preparerCompteRendu } from './compte-rendu-prepare.js';
import { deposerSujet } from './depot.js';
import { listInbox, marquerTraite } from './service.js';

describe('Inbox : compte rendu préparé', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'cr-a', nom: 'A', type: 'mandat' });
    b = await createInstance(t.owner.db, { slug: 'cr-b', nom: 'B', type: 'mandat' });
  });
  afterAll(async () => {
    await t.drop();
  });

  const deposer = (
    inst: Instance,
    cle: string,
    type: 'compte_rendu' | 'mail_a_repondre' = 'compte_rendu',
  ) =>
    withInstance(t.owner.db, inst.id, (tx) =>
      deposerSujet(tx, {
        type,
        titre: `Rédiger le compte rendu ${cle}`,
        origine: 'agenda',
        source: 'routine',
        sourceId: cle,
      }),
    );
  const preparer = (inst: Instance, sujetId: string, texte: string) =>
    withInstance(t.owner.db, inst.id, (tx) => preparerCompteRendu(tx, sujetId, texte));
  const vue = async (inst: Instance, id: string) =>
    (await listInbox(t.app.db, inst, 'tout')).find((s) => s.id === id);

  it('rattache le brouillon au sujet compte rendu, visible dans la liste', async () => {
    const { id } = await deposer(a, 'evt-1');
    expect(await preparer(a, id, 'Points abordés : le budget fictif.')).toEqual({
      statut: 'enregistree',
    });
    const s = await vue(a, id);
    expect(s?.compteRenduPrepare?.texte).toBe('Points abordés : le budget fictif.');
    expect(s?.compteRenduPrepare?.prepareeLe).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('remplace le brouillon précédent', async () => {
    const { id } = await deposer(a, 'evt-2');
    await preparer(a, id, 'Première version.');
    await preparer(a, id, 'Seconde version.');
    expect((await vue(a, id))?.compteRenduPrepare?.texte).toBe('Seconde version.');
  });

  it("ne touche ni un autre type de sujet, ni un sujet traité, ni celui d'un autre espace", async () => {
    const mail = await deposer(a, 'fil-mail', 'mail_a_repondre');
    expect(await preparer(a, mail.id, 'x')).toEqual({ statut: 'introuvable' });
    const traite = await deposer(a, 'evt-traite');
    await marquerTraite(t.owner.db, a, traite.id);
    expect(await preparer(a, traite.id, 'x')).toEqual({ statut: 'introuvable' });
    const autre = await deposer(b, 'evt-b');
    expect(await preparer(a, autre.id, 'x')).toEqual({ statut: 'introuvable' });
    expect(await preparer(a, crypto.randomUUID(), 'x')).toEqual({ statut: 'introuvable' });
  });
});
