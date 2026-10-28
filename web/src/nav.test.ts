import { describe, expect, it } from 'vitest';
import {
  allItems,
  allowed,
  groupInstances,
  isBuilt,
  libelleType,
  NAV,
  vueCanonique,
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
  it('has Inbox in Pilotage instead of À valider', () => {
    const pilotage = NAV.find((g) => g.title === 'Pilotage');
    expect(pilotage?.items.find((i) => i.id === 'inbox')).toMatchObject({
      label: 'Inbox',
      icon: 'inbox',
    });
    expect(allItems().some((i) => i.id === 'validations' || i.label === 'À valider')).toBe(false);
    expect(isBuilt('inbox')).toBe(true);
  });

  it('redirects the former validations screen to the Inbox', () => {
    expect(vueCanonique('validations')).toBe('inbox');
    expect(vueCanonique('taches')).toBe('agenda');
    expect(vueCanonique('rendez-vous')).toBe('rendez-vous');
  });

  it('garde une seule entrée (Outils) et redirige les anciennes adresses', () => {
    const entrees = allItems().filter((i) =>
      ['diagnostic', 'diagnostics', 'tests-vma'].includes(i.id),
    );
    expect(entrees.map((i) => i.id)).toEqual(['diagnostics']);
    expect(isBuilt('diagnostics')).toBe(true);
    expect(vueCanonique('diagnostic')).toBe('diagnostics');
    expect(vueCanonique('tests-vma')).toBe('diagnostics');
  });

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
    const site = allItems().find((i) => i.id === 'siteweb');
    expect(site && allowed(site, ['devis'])).toBe(false);
    expect(site && allowed(site, ['site-web'])).toBe(true);
  });

  it('marks only built screens as built', () => {
    expect(isBuilt('entreprises')).toBe(true);
    expect(isBuilt('contacts')).toBe(true);
    expect(isBuilt('agenda')).toBe(true);
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
