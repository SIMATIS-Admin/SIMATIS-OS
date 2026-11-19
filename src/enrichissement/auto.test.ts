import { describe, expect, it } from 'vitest';
import type { baseVivante } from '../base-vivante/schema.js';
import { ecritureAutomatique } from './auto.js';
import type { Suggestion } from './schema.js';

type Fiche = typeof baseVivante.$inferSelect;
const fiche = (extra: Partial<Fiche> = {}) =>
  ({
    prenom: 'Claire',
    nom: 'Martin',
    email: null,
    telephone: null,
    linkedin: null,
    fonction: null,
    opposition: false,
    exclusion: null,
    ...extra,
  }) as Fiche;
const suggestion = (extra: Partial<Suggestion> = {}) =>
  ({
    prenom: 'Claire',
    nom: 'Martin',
    email: 'claire@atelier-fictif.test',
    telephone: null,
    linkedin: null,
    fonction: null,
    preuve: 'page_domaine',
    ...extra,
  }) as Suggestion;

describe('écriture automatique', () => {
  it('preuve forte, même personne, champ vide : écrit', () => {
    expect(ecritureAutomatique(fiche(), suggestion())).toBe(true);
  });

  it('une preuve plus faible reste une suggestion', () => {
    for (const preuve of ['page_publiee', 'page_sans_mail', 'deduit', 'sans_source', null] as const)
      expect(ecritureAutomatique(fiche(), suggestion({ preuve }))).toBe(false);
  });

  it('une valeur différente déjà en base est un conflit : rien n’est écrit', () => {
    const f = fiche({ email: 'autre@atelier-fictif.test' });
    expect(ecritureAutomatique(f, suggestion())).toBe(false);
    const g = fiche({ telephone: '+33450123456' });
    expect(ecritureAutomatique(g, suggestion({ telephone: '+33450999999' }))).toBe(false);
  });

  it('la même valeur déjà en base ne change rien : pas d’écriture inutile', () => {
    expect(ecritureAutomatique(fiche({ email: 'claire@atelier-fictif.test' }), suggestion())).toBe(
      false,
    );
  });

  it('complète un champ vide à côté d’un champ identique', () => {
    const f = fiche({ email: 'claire@atelier-fictif.test' });
    expect(ecritureAutomatique(f, suggestion({ fonction: 'Responsable achats' }))).toBe(true);
  });

  it('jamais pour une autre personne, une fiche sans contact, en opposition ou exclue', () => {
    expect(ecritureAutomatique(fiche(), suggestion({ nom: 'Petit' }))).toBe(false);
    expect(ecritureAutomatique(fiche(), suggestion({ prenom: 'Paul' }))).toBe(false);
    expect(ecritureAutomatique(fiche({ nom: '', prenom: null }), suggestion())).toBe(false);
    expect(ecritureAutomatique(fiche({ opposition: true }), suggestion())).toBe(false);
    expect(ecritureAutomatique(fiche({ exclusion: 'doublon' as never }), suggestion())).toBe(false);
  });

  it('ignore les accents et la casse du nom', () => {
    expect(
      ecritureAutomatique(fiche({ nom: 'MARTIN', prenom: 'Zoé' }), suggestion({ prenom: 'Zoe' })),
    ).toBe(true);
  });
});
