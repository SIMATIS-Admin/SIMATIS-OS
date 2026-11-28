import { describe, expect, it } from 'vitest';
import type { NoeudCerveau } from './cerveau.js';
import {
  ajouterEtape,
  compterOrganigramme,
  disposerOrganigramme,
  idéesOS,
  lireOrganigramme,
  marquerPromue,
} from './feuilleDeRouteOS.js';

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

describe('lireOrganigramme', () => {
  const note = [
    '---',
    'title: fictif',
    '---',
    '',
    '# Organigramme',
    '- ligne avant toute rubrique, ignorée',
    '',
    '## Rubrique A',
    '- Module un [en service] — fait ceci',
    '  - Fonction [à essayer] — fait cela',
    '    - Détail sans état',
    '  - Autre fonction [partiel]',
    '- Module deux — sans état',
    '',
    '## Rubrique B',
    '- Module trois [en service]',
  ].join('\n');

  it('range les rubriques, les niveaux, les états et les descriptions', () => {
    const [a, b] = lireOrganigramme(note);
    expect(a?.titre).toBe('Rubrique A');
    expect(a?.noeuds.map((n) => n.nom)).toEqual(['Module un', 'Module deux']);
    const un = a?.noeuds[0];
    expect(un).toMatchObject({ etat: 'en service', description: 'fait ceci' });
    expect(un?.enfants.map((n) => [n.nom, n.etat])).toEqual([
      ['Fonction', 'à essayer'],
      ['Autre fonction', 'partiel'],
    ]);
    expect(un?.enfants[0]?.enfants[0]).toMatchObject({ nom: 'Détail sans état', etat: null });
    expect(a?.noeuds[1]).toMatchObject({ etat: null, description: 'sans état' });
    expect(b?.noeuds).toHaveLength(1);
  });

  it('rattache au plus proche parent une indentation trop profonde', () => {
    const [r] = lireOrganigramme('## R\n- A\n      - B');
    expect(r?.noeuds[0]?.enfants.map((n) => n.nom)).toEqual(['B']);
  });

  it('rend une liste vide pour un texte sans rubrique', () => {
    expect(lireOrganigramme('# Titre\n- seul')).toEqual([]);
  });
});

describe('disposerOrganigramme', () => {
  const note = [
    '## Détecter',
    '- Radar [en service] — pipe',
    '## Piloter l’activité',
    '- Gestion [en service]',
    '## Rubrique nouvelle',
    '- Fonction X [à essayer] — nouvelle',
    '  - Sous-fonction [partiel]',
  ].join('\n');

  it('place les rubriques connues et garde les inconnues à part', () => {
    const d = disposerOrganigramme(lireOrganigramme(note));
    expect(d.colonnes.map((c) => c.titre)).toEqual(['Détecter', 'Vendre', 'Piloter']);
    expect(d.colonnes[0]?.noeuds.map((n) => n.nom)).toEqual(['Radar']);
    expect(d.colonnes[1]?.noeuds).toEqual([]);
    expect(d.colonnes[2]?.noeuds.map((n) => n.nom)).toEqual(['Gestion']);
    expect(d.autres.map((r) => r.titre)).toEqual(['Rubrique nouvelle']);
  });

  it('accepte l’apostrophe droite dans les titres et les noms', () => {
    const d = disposerOrganigramme(
      lireOrganigramme("## Piloter l'activité\n- Feuille de route de l'OS [à essayer]"),
    );
    expect(d.colonnes[2]?.noeuds.map((n) => n.nom)).toEqual(['Feuille de route de l’OS']);
    expect(d.autres).toEqual([]);
  });

  it('compte les fonctions et sous-fonctions, et celles en service', () => {
    expect(compterOrganigramme(lireOrganigramme(note))).toEqual({ total: 4, enService: 2 });
  });
});
