import { describe, expect, it } from 'vitest';
import { lireManifest, lireModule, remplacerVariables } from './parseur.js';

const MODULE = `---
titre: Prompting
duree: 45
objectif: Écrire un prompt qui tient sur plusieurs sources
---

## Première slide
type: concept

Corps en **markdown**.

::: notes
Ce que le formateur dit.
:::

---

## Slide en colonnes
type: atelier
livrable: Un prompt maître enregistré
colonnes: 2

Colonne de gauche.

::: colonne

Colonne de droite.

---

## Sans type
Juste du texte.
`;

describe('lireManifest', () => {
  it('lit le titre, le sous-titre, les variables par défaut et les modules', () => {
    expect(
      lireManifest({
        titre: 'Support fictif',
        soustitre: 'Sous-titre',
        generique: { prenom: 'votre interlocuteur', nombre: 3 },
        modules: ['01-a.md', 4, '02-b.md'],
      }),
    ).toMatchObject({
      titre: 'Support fictif',
      soustitre: 'Sous-titre',
      generique: { prenom: 'votre interlocuteur' },
      modules: ['01-a.md', '02-b.md'],
      logo: null,
      couleur: null,
      accent: null,
    });
  });
  it('lit le logo et les couleurs, et refuse un chemin ou une couleur douteuse', () => {
    expect(
      lireManifest({ logo: 'img/logo.svg', couleur: '#0C376B', accent: '#9FF7E8' }),
    ).toMatchObject({
      logo: 'img/logo.svg',
      couleur: '#0C376B',
      accent: '#9FF7E8',
    });
    expect(
      lireManifest({ logo: '../secret.png', couleur: 'red; background:url(x)', accent: '#12' }),
    ).toMatchObject({ logo: null, couleur: null, accent: null });
  });
  it('tient un manifest vide ou invalide', () => {
    expect(lireManifest(null)).toMatchObject({
      titre: 'Support',
      soustitre: '',
      generique: {},
      modules: [],
    });
  });
});

describe('lireManifest, support en HTML libre', () => {
  it('lit le format, la feuille de style, les polices et les parties', () => {
    const m = lireManifest({
      format: 'html',
      css: 'deck.css',
      polices: ['https://fonts.googleapis.com/css2?family=Manrope', 'https://autre.test/x.css'],
      parties: [
        { titre: 'Accueil', duree: 4, slides: ['slides/cover.html', '../secret.html', 3] },
        { titre: 'Vide', slides: [] },
      ],
    });
    expect(m.format).toBe('html');
    expect(m.css).toBe('deck.css');
    expect(m.polices).toEqual(['https://fonts.googleapis.com/css2?family=Manrope']);
    expect(m.parties).toEqual([{ titre: 'Accueil', duree: 4, slides: ['slides/cover.html'] }]);
  });
  it('reste en markdown par défaut', () => {
    expect(lireManifest({ titre: 'x' })).toMatchObject({ format: 'md', css: null, parties: [] });
  });
});

describe('lireModule', () => {
  const m = lireModule(MODULE);
  it('lit le front matter', () => {
    expect(m).toMatchObject({
      titre: 'Prompting',
      duree: 45,
      objectif: 'Écrire un prompt qui tient sur plusieurs sources',
    });
  });
  it('sépare les slides sur les --- seuls sur leur ligne, sans confondre avec le front matter', () => {
    expect(m.slides.map((s) => s.titre)).toEqual([
      'Première slide',
      'Slide en colonnes',
      'Sans type',
    ]);
  });
  it('lit le type, retire les notes du corps et les garde à part', () => {
    expect(m.slides[0]).toMatchObject({
      type: 'concept',
      colonnes: ['Corps en **markdown**.'],
      notes: 'Ce que le formateur dit.',
    });
  });
  it('découpe le corps sur les ::: colonne et lit le livrable', () => {
    expect(m.slides[1]).toMatchObject({
      type: 'atelier',
      livrable: 'Un prompt maître enregistré',
      colonnes: ['Colonne de gauche.', 'Colonne de droite.'],
    });
  });
  it('prend le type concept par défaut ou si le type est inconnu', () => {
    expect(m.slides[2]!.type).toBe('concept');
    expect(lireModule('## A\ntype: inconnu\n\nTexte').slides[0]!.type).toBe('concept');
  });
  it('lit un module sans front matter ni slide valide', () => {
    expect(lireModule('## Seule\n\nTexte').slides).toHaveLength(1);
    expect(lireModule('du texte sans titre')).toMatchObject({ titre: '', duree: null, slides: [] });
  });
  it('tient les fins de ligne Windows', () => {
    expect(lireModule(MODULE.replace(/\n/g, '\r\n')).slides).toHaveLength(3);
  });
});

describe('remplacerVariables', () => {
  it('prend le profil client, puis la valeur générique, sinon laisse la variable', () => {
    const texte = '{{client.prenom}} chez {{ client.entreprise }} ({{client.crm}})';
    expect(
      remplacerVariables(
        texte,
        { prenom: 'Alex' },
        { prenom: 'x', entreprise: 'votre entreprise' },
      ),
    ).toBe('Alex chez votre entreprise ({{client.crm}})');
  });
});
