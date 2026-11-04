import { describe, expect, it } from 'vitest';
import type { NoeudCerveau } from './cerveau.js';
import { documents, fils, sansEntete } from './partage.js';

const msg = (
  id: string,
  titre: string,
  auteur: string,
  genre: string,
  reponseA: string | null = null,
): NoeudCerveau => ({
  id: `echanges/${id}.md`,
  titre,
  categorie: 'echanges',
  statut: null,
  auteur,
  genre,
  reponseA: reponseA ? `echanges/${reponseA}.md` : null,
});

const noeuds: NoeudCerveau[] = [
  msg('2026-10-29-1000-christophe-a', 'Relais fictif', 'christophe', 'question'),
  msg(
    '2026-10-30-0900-marc-b',
    'Re : Relais fictif',
    'marc',
    'reponse',
    '2026-10-29-1000-christophe-a',
  ),
  msg(
    '2026-10-31-0900-christophe-c',
    'Suite fictive',
    'christophe',
    'info',
    '2026-10-30-0900-marc-b',
  ),
  msg('2026-11-01-0900-christophe-d', 'Point fictif', 'christophe', 'question'),
  msg('2026-11-02-0900-marc-e', 'Test fictif', 'marc', 'question'),
  { id: 'reference/offre.md', titre: 'Offre fictive', categorie: 'reference', statut: null },
];

describe('fils', () => {
  const f = fils(noeuds, 'marc');

  it('regroupe une conversation par chaînage des réponses, la plus récente en premier', () => {
    expect(f.map((x) => x.sujet)).toEqual(['Test fictif', 'Point fictif', 'Relais fictif']);
    expect(f[2]?.messages.map((m) => m.auteur)).toEqual(['christophe', 'marc', 'christophe']);
    expect(f[2]?.id).toBe('echanges/2026-10-29-1000-christophe-a.md');
  });

  it('une question de l’autre sans réponse est à répondre, la vôtre est en attente', () => {
    expect(f.find((x) => x.sujet === 'Point fictif')).toMatchObject({
      aRepondre: true,
      enAttente: false,
    });
    expect(f.find((x) => x.sujet === 'Test fictif')).toMatchObject({
      aRepondre: false,
      enAttente: true,
    });
    expect(f.find((x) => x.sujet === 'Relais fictif')).toMatchObject({
      aRepondre: false,
      enAttente: false,
    });
  });

  it('sans savoir qui consulte, aucune conversation n’est marquée à répondre', () => {
    expect(fils(noeuds, '').some((x) => x.aRepondre || x.enAttente)).toBe(false);
  });

  it('un message dont le parent manque ouvre sa propre conversation', () => {
    const seul = fils(
      [msg('2026-11-03-0900-marc-f', 'Orphelin', 'marc', 'reponse', 'inconnu')],
      'marc',
    );
    expect(seul).toHaveLength(1);
    expect(seul[0]?.sujet).toBe('Orphelin');
  });

  it('ne boucle pas sur un cycle de réponses', () => {
    const a = msg('a', 'A', 'marc', 'reponse', 'b');
    const b = msg('b', 'B', 'christophe', 'reponse', 'a');
    expect(fils([a, b], 'marc')).toHaveLength(1);
  });
});

describe('documents et texte', () => {
  it('les documents excluent les échanges', () => {
    expect(documents(noeuds).map((d) => d.id)).toEqual(['reference/offre.md']);
  });
  it('retire l’en-tête d’un message', () => {
    expect(sansEntete('---\nde: marc\nsujet: "S"\n---\n\nBonjour.\n')).toBe('Bonjour.');
    expect(sansEntete('Sans en-tête')).toBe('Sans en-tête');
  });
});
