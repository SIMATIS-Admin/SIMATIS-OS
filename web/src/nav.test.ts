import { describe, expect, it } from 'vitest';
import {
  allItems,
  allowed,
  groupInstances,
  isBuilt,
  reorderFavoris,
  toggleFavori,
  type InstanceSummary,
} from './nav.js';

const inst = (slug: string, type: InstanceSummary['type']): InstanceSummary => ({
  slug,
  nom: slug,
  sous: '',
  type,
  couleur: '#000',
  modules: [],
});

describe('nav', () => {
  it('groups instances by type and keeps their order', () => {
    const groups = groupInstances([
      inst('b', 'mandat'),
      inst('s', 'propre'),
      inst('a', 'mandat'),
      inst('d', 'prospect'),
    ]);
    expect(groups.map((g) => [g.type, g.instances.map((i) => i.slug)])).toEqual([
      ['propre', ['s']],
      ['mandat', ['b', 'a']],
      ['prospect', ['d']],
    ]);
  });

  it('hides module screens (Devis) from instances without the module', () => {
    const devis = allItems().find((i) => i.id === 'devis');
    if (!devis) throw new Error('Devis missing from NAV');
    expect(allowed(devis, ['relais'])).toBe(false);
    expect(allowed(devis, ['devis'])).toBe(true);
  });

  it('marks only built screens as built', () => {
    expect(isBuilt('entreprises')).toBe(true);
    expect(isBuilt('contacts')).toBe(true);
    expect(isBuilt('pipeline')).toBe(true);
    expect(isBuilt('brief')).toBe(true);
    expect(isBuilt('tableau')).toBe(true);
    expect(isBuilt('devis')).toBe(false);
  });

  it('reorders favourites before or after a target', () => {
    const f = ['pipeline', 'brief', 'prospection'];
    expect(reorderFavoris(f, 'prospection', 'pipeline', false)).toEqual([
      'prospection',
      'pipeline',
      'brief',
    ]);
    expect(reorderFavoris(f, 'pipeline', 'brief', true)).toEqual([
      'brief',
      'pipeline',
      'prospection',
    ]);
    expect(reorderFavoris(f, 'brief', 'brief', true)).toBe(f);
    expect(reorderFavoris(f, 'absent', 'brief', true)).toBe(f);
    expect(reorderFavoris(f, 'brief', 'absent', false)).toBe(f);
  });

  it('adds or removes a favourite', () => {
    expect(toggleFavori(['brief'], 'pipeline')).toEqual(['brief', 'pipeline']);
    expect(toggleFavori(['brief', 'pipeline'], 'brief')).toEqual(['pipeline']);
  });
});
