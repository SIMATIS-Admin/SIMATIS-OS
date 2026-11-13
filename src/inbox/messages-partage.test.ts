import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Noeud } from '../cerveau/carte.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { deposerMessagesPartage, titreMessage } from './messages-partage.js';

const maintenant = new Date('2026-11-13T17:00:00Z');
const message = (id: string, extra: Partial<Noeud> = {}): Noeud => ({
  id,
  titre: 'Un lecteur de présentation',
  categorie: 'echanges',
  statut: null,
  genre: 'info',
  auteur: 'christophe',
  date: '2026-11-13T14:53:00Z',
  ...extra,
});

describe('Inbox : messages de l’espace partagé', () => {
  let t: TestApp;
  let a: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'partage-inbox', nom: 'P', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });

  const cles = async () =>
    (
      await t.owner.pool.query<{ source_id: string; titre: string; type: string }>(
        'select source_id, titre, type from sujets where instance_id = $1 order by source_id',
        [a.id],
      )
    ).rows;

  it('deposits a new message of the other, once, with the routine key', async () => {
    const carte = {
      moi: 'marc',
      noeuds: [
        message('echanges/2026-11-13-1553-christophe-lecteur.md'),
        message('echanges/2026-11-13-1013-marc-re.md', { auteur: 'marc' }),
        message('echanges/2026-10-01-0900-christophe-vieux.md', { date: '2026-10-01T07:00:00Z' }),
        message('reference/offre.md', { categorie: 'reference' }),
      ],
    };
    expect(await deposerMessagesPartage(t.owner.db, a, carte, maintenant)).toBe(1);
    expect(await deposerMessagesPartage(t.owner.db, a, carte, maintenant)).toBe(0);
    expect(await cles()).toEqual([
      {
        source_id: 'partage:echanges/2026-11-13-1553-christophe-lecteur.md',
        titre: 'Lire le message de Christophe : Un lecteur de présentation',
        type: 'autre',
      },
    ]);
  });

  it('deposits nothing when the viewer is unknown, and asks for an answer to a question', async () => {
    const q = message('echanges/2026-11-13-1600-christophe-q.md', { genre: 'question' });
    expect(await deposerMessagesPartage(t.owner.db, a, { noeuds: [q] }, maintenant)).toBe(0);
    expect(
      await deposerMessagesPartage(t.owner.db, a, { moi: 'marc', noeuds: [q] }, maintenant),
    ).toBe(1);
    expect(titreMessage(q)).toBe('Répondre à Christophe : Un lecteur de présentation');
    expect(titreMessage({ ...q, genre: 'reponse' })).toBe(
      'Christophe répond : Un lecteur de présentation',
    );
  });
});
