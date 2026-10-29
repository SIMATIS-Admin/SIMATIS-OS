import { describe, expect, it } from 'vitest';
import type { NoeudCerveau } from './cerveau.js';
import { ajouterEtape, idéesOS, marquerPromue } from './feuilleDeRouteOS.js';

const noeud = (id: string, extra: Partial<NoeudCerveau>): NoeudCerveau => ({
  id,
  titre: id,
  categorie: 'idees-en-vrac',
  statut: 'draft',
  concerne: 'os',
  ...extra,
});

describe('idéesOS', () => {
  it('ne garde que les idées en brouillon qui concernent l’OS', () => {
    const gardee = noeud('a.md', {});
    const noeuds = [
      gardee,
      noeud('b.md', { statut: 'promue' }),
      noeud('c.md', { categorie: 'clients' }),
      noeud('d.md', { concerne: null }),
    ];
    expect(idéesOS(noeuds)).toEqual([gardee]);
  });
});

describe('ajouterEtape', () => {
  it('ajoute une ligne à faire en fin de note, liée à l’idée', () => {
    const res = ajouterEtape(
      '# Feuille\n\n- fait — x',
      'Idée fictive',
      'brain/idees-en-vrac/2026-10-29_idee-fictive.md',
    );
    expect(res.startsWith('# Feuille\n\n- fait — x\n')).toBe(true);
    expect(
      res.endsWith('\n- à faire — [Idée fictive](../idees-en-vrac/2026-10-29_idee-fictive.md)\n'),
    ).toBe(true);
  });
});

describe('marquerPromue', () => {
  it('change le statut de l’en-tête et pas une ligne du corps', () => {
    const res = marquerPromue('---\nstatut: draft\n---\n\n# T\n\nstatut: draft dans le corps');
    expect(res).toBe('---\nstatut: promue\n---\n\n# T\n\nstatut: draft dans le corps');
  });

  it('accepte les variantes d’espaces que la carte accepte', () => {
    expect(marquerPromue('---\nstatut:draft \n---\n')).toBe('---\nstatut: promue\n---\n');
    expect(marquerPromue('---\nstatut:   draft\n---\n')).toBe('---\nstatut: promue\n---\n');
  });

  it('laisse inchangé un texte sans en-tête draft', () => {
    expect(marquerPromue('# T\n')).toBe('# T\n');
  });
});
