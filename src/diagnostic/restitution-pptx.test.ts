import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { genererDeckPptx, nomFichierDeck } from './restitution-pptx.js';

const diapositives = [
  {
    titre: 'Restitution fictive',
    texte: 'Un diagnostic pour une entreprise fictive',
    notes: 'Accueil, 5 min',
  },
  {
    titre: 'Résultats & profil',
    texte: 'Outils : 4,5 sur 10\nStratégie : 8,9 sur 10',
    notes: '15 min',
  },
  { titre: 'Proposition', texte: '', notes: '' },
];

const lire = async () => {
  const zip = unzipSync(await genererDeckPptx({ entreprise: 'Entreprise Fictive', diapositives }));
  return (nom: string) => (zip[nom] ? strFromU8(zip[nom]) : undefined);
};

describe('genererDeckPptx', () => {
  it('produit un fichier PowerPoint avec une diapositive par entrée', async () => {
    const octets = await genererDeckPptx({ entreprise: 'Entreprise Fictive', diapositives });
    // Un .pptx est une archive zip.
    expect(Array.from(octets.slice(0, 2))).toEqual([0x50, 0x4b]);
    const fichier = await lire();
    for (const n of [1, 2, 3]) expect(fichier(`ppt/slides/slide${n}.xml`)).toBeDefined();
    expect(fichier('ppt/slides/slide4.xml')).toBeUndefined();
  });

  it('reprend les titres, chaque ligne du texte et les notes d orateur', async () => {
    const fichier = await lire();
    expect(fichier('ppt/slides/slide2.xml')).toContain('Résultats &amp; profil');
    expect(fichier('ppt/slides/slide2.xml')).toContain('Outils : 4,5 sur 10');
    expect(fichier('ppt/slides/slide2.xml')).toContain('Stratégie : 8,9 sur 10');
    expect(fichier('ppt/notesSlides/notesSlide1.xml')).toContain('Accueil, 5 min');
  });

  it('nomme le fichier d après l entreprise, sans caractère interdit', () => {
    expect(nomFichierDeck('Atelier "Fictif" / Nord')).toBe(
      'Restitution - Atelier Fictif Nord.pptx',
    );
  });
});
