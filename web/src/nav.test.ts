import { describe, expect, it } from 'vitest';
import { allItems, allowed, groupInstances, isBuilt, type InstanceSummary } from './nav.js';

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
    expect(isBuilt('pipeline')).toBe(false);
  });
});
