import { describe, expect, it } from 'vitest';
import {
  allItems,
  allowed,
  groupInstances,
  isBuilt,
  libelleType,
  reorderFavoris,
  toggleFavori,
  type InstanceSummary,
} from './nav.js';

const inst = (
  slug: string,
  type: InstanceSummary['type'],
  phase: InstanceSummary['phase'] = type === 'mandat' ? 'en_cours' : null,
): InstanceSummary => ({
  slug,
  nom: slug,
  sous: '',
  type,
  phase,
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
      ['en_cours', ['b', 'a']],
      ['prospect', ['d']],
    ]);
  });

  it('groups mandates by phase and labels demos', () => {
    const groups = groupInstances([
      inst('c', 'mandat', 'closing'),
      inst('d', 'prospect'),
      inst('b', 'mandat', 'en_cours'),
      inst('s', 'propre'),
    ]);
    expect(groups.map((g) => [g.label, g.instances.map((i) => i.slug)])).toEqual([
      ['Mon activité', ['s']],
      ['Mandats en cours', ['b']],
      ['Mandats en Closing', ['c']],
      ['Démos', ['d']],
    ]);
    expect(libelleType(inst('c', 'mandat', 'closing'))).toBe('Mandat en Closing');
    expect(libelleType(inst('b', 'mandat'))).toBe('Mandat en cours');
    expect(libelleType(inst('d', 'prospect'))).toBe('Démo');
    expect(libelleType(inst('s', 'propre'))).toBe('Mon activité');
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
    expect(isBuilt('taches')).toBe(true);
    expect(isBuilt('pipeline')).toBe(true);
    expect(isBuilt('brief')).toBe(true);
    expect(isBuilt('tableau')).toBe(true);
    expect(isBuilt('devis')).toBe(true);
    expect(isBuilt('prospection')).toBe(false);
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
