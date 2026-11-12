import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { deposerSujet } from './depot.js';
import { preparerReponse } from './reponse-preparee.js';
import { listInbox, marquerTraite } from './service.js';

describe('Inbox : réponse préparée', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'rep-a', nom: 'A', type: 'mandat' });
    b = await createInstance(t.owner.db, { slug: 'rep-b', nom: 'B', type: 'mandat' });
  });
  afterAll(async () => {
    await t.drop();
  });

  const deposer = (inst: Instance, cle: string) =>
    withInstance(t.owner.db, inst.id, (tx) =>
      deposerSujet(tx, {
        type: 'mail_a_repondre',
        titre: 'Répondre à une demande fictive',
        origine: 'messagerie',
        source: 'routine',
        sourceId: cle,
      }),
    );
  const preparer = (inst: Instance, cle: string, reponse: Parameters<typeof preparerReponse>[2]) =>
    withInstance(t.owner.db, inst.id, (tx) => preparerReponse(tx, cle, reponse));
  const vue = async (inst: Instance) =>
    (await listInbox(t.app.db, inst, 'tout')).find((s) => s.titre.includes('fictive'));

  it('rattache le brouillon de réponse au sujet de la même clé, visible dans la liste', async () => {
    await deposer(a, 'fil-1');
    const r = await preparer(a, 'fil-1', {
      objet: 'Re : demande fictive',
      texte: 'Bonjour Alice, voici ma réponse.',
      lienBrouillon: 'https://mail.google.com/mail/u/0/#drafts/abc',
    });
    expect(r).toEqual({ statut: 'enregistree' });
    const s = await vue(a);
    expect(s?.reponsePreparee).toMatchObject({
      objet: 'Re : demande fictive',
      texte: 'Bonjour Alice, voici ma réponse.',
      lienBrouillon: 'https://mail.google.com/mail/u/0/#drafts/abc',
    });
    expect(s?.reponsePreparee?.prepareeLe).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('remplace le brouillon précédent quand la routine en prépare un nouveau', async () => {
    await preparer(a, 'fil-1', { texte: 'Seconde version.' });
    expect((await vue(a))?.reponsePreparee).toMatchObject({
      texte: 'Seconde version.',
      objet: null,
      lienBrouillon: null,
    });
  });

  it("répond « introuvable » pour une clé inconnue ou celle d'un autre espace", async () => {
    expect(await preparer(a, 'fil-inconnu', { texte: 'x' })).toEqual({ statut: 'introuvable' });
    await deposer(b, 'fil-b');
    expect(await preparer(a, 'fil-b', { texte: 'x' })).toEqual({ statut: 'introuvable' });
  });

  it("n'écrit rien sur un sujet déjà traité", async () => {
    const { id } = await deposer(a, 'fil-traite');
    await marquerTraite(t.owner.db, a, id);
    expect(await preparer(a, 'fil-traite', { texte: 'Trop tard.' })).toEqual({
      statut: 'introuvable',
    });
  });

  it('refuse un lien qui ne soit pas une adresse web', async () => {
    await deposer(a, 'fil-lien');
    await expect(
      preparer(a, 'fil-lien', { texte: 'x', lienBrouillon: 'javascript:alert(1)' }),
    ).rejects.toThrow(/adresse web/);
  });
});
