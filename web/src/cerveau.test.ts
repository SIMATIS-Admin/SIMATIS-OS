import { describe, expect, it } from 'vitest';
import { categorieInfo, disposer, voisins } from './cerveau.js';

describe('disposer', () => {
  const noeuds = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const liens = [
    { de: 'a', vers: 'b' },
    { de: 'b', vers: 'c' },
  ];

  it('donne une position finie à chaque note, toujours la même pour les mêmes données', () => {
    const p1 = disposer(noeuds, liens);
    const p2 = disposer(noeuds, liens);
    expect(p1).toHaveLength(4);
    expect(p1.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(p1).toEqual(p2);
  });

  it('rapproche les notes liées et écarte les notes sans lien', () => {
    const p = Object.fromEntries(disposer(noeuds, liens).map((q) => [q.id, q]));
    const dist = (a: string, b: string) => Math.hypot(p[a]!.x - p[b]!.x, p[a]!.y - p[b]!.y);
    expect(dist('a', 'b')).toBeLessThan(dist('a', 'd'));
  });

  it('ignore un lien vers une note absente et accepte une carte vide', () => {
    expect(disposer(noeuds, [{ de: 'a', vers: 'zzz' }])).toHaveLength(4);
    expect(disposer([], [])).toEqual([]);
  });
});

describe('voisins et catégories', () => {
  it('sépare les liens sortants et entrants', () => {
    const carte = {
      liens: [
        { de: 'a', vers: 'b' },
        { de: 'c', vers: 'a' },
      ],
    };
    expect(voisins(carte, 'a')).toEqual({ sortants: ['b'], entrants: ['c'] });
  });

  it('donne un libellé et une couleur, y compris à une catégorie inconnue', () => {
    expect(categorieInfo('clients').libelle).toBe('Clients');
    expect(categorieInfo('nouveau')).toMatchObject({ libelle: 'nouveau' });
  });
});
