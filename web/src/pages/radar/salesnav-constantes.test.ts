import { describe, expect, it } from 'vitest';
import { grouperCibles, optionsCibles } from './salesnav-constantes.js';

const ciblages = [
  { entreprise: 'Entreprise Fictive', code: 'ICP A', nom: 'Bureaux d’études' },
  { entreprise: 'Entreprise Fictive', code: 'ICP B', nom: 'Cabinets d’avocats' },
  { entreprise: null, code: 'ICP A', nom: 'Artisans' },
];

describe('optionsCibles', () => {
  it('reconstitue la valeur enregistrée et garde le nom du segment', () => {
    const o = optionsCibles(ciblages, []);
    expect(o.map((x) => x.valeur)).toEqual([
      'Entreprise Fictive · ICP A',
      'Entreprise Fictive · ICP B',
      'ICP A',
    ]);
    expect(o[0]).toMatchObject({
      groupe: 'Entreprise Fictive',
      code: 'ICP A',
      nom: 'Bureaux d’études',
    });
  });

  it('ajoute les cibles inconnues de l’Atelier sans doublon ni vide', () => {
    const o = optionsCibles(ciblages, ['Ancienne cible', 'Ancienne cible', null, 'ICP A']);
    expect(o.filter((x) => x.valeur === 'Ancienne cible')).toHaveLength(1);
    expect(o.at(-1)).toMatchObject({ groupe: 'Autres', nom: '' });
    expect(o.filter((x) => x.valeur === 'ICP A')).toHaveLength(1);
  });

  it('regroupe par entreprise en gardant l’ordre', () => {
    const g = grouperCibles(optionsCibles(ciblages, []));
    expect(g.map(([nom, l]) => [nom, l.length])).toEqual([
      ['Entreprise Fictive', 2],
      ['Autres', 1],
    ]);
  });
});
