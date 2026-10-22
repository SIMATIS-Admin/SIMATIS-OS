import { describe, expect, it } from 'vitest';
import { fabriquerXlsx } from '../../test/xlsx.js';
import { detecterSeparateur, FichierIllisible, lireFichier, lireTexte } from './lecture.js';

describe('lecture des fichiers', () => {
  it('détecte le point-virgule, la virgule et la tabulation', () => {
    expect(detecterSeparateur('a;b;c\n1;2;3')).toBe(';');
    expect(detecterSeparateur('a,b,c\n1,2,3')).toBe(',');
    expect(detecterSeparateur('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('lit un CSV avec guillemets, retour à la ligne dans une cellule et lignes vides', async () => {
    const csv = 'Société;Nom\r\n"Atelier ""Fictif"" ; SA";Durand\r\n\r\n"Bureau\nFictif";Petit\r\n';
    const [feuille] = await lireFichier('x.csv', Buffer.from(csv));
    expect(feuille?.lignes).toEqual([
      ['Société', 'Nom'],
      ['Atelier "Fictif" ; SA', 'Durand'],
      ['Bureau\nFictif', 'Petit'],
    ]);
  });

  it('retire le BOM UTF-8 et lit le Windows-1252', async () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Société;Nom\nA;B')]);
    expect((await lireFichier('a.csv', bom))[0]?.lignes[0]).toEqual(['Société', 'Nom']);
    const win = Buffer.from([
      0x53, 0x6f, 0x63, 0x69, 0xe9, 0x74, 0xe9, 0x3b, 0x4e, 0x0a, 0x41, 0x3b, 0x42,
    ]);
    expect((await lireFichier('b.csv', win))[0]?.lignes[0]).toEqual(['Société', 'N']);
  });

  it('lit un Excel avec plusieurs onglets et ignore les onglets vides', async () => {
    const xlsx = fabriquerXlsx([
      {
        nom: 'Nord',
        lignes: [
          ['Société', 'Email'],
          ['Atelier Fictif', 'a@atelier-fictif.test'],
        ],
      },
      { nom: 'Vide', lignes: [] },
      { nom: 'Sud', lignes: [['Société'], ['Bureau Fictif']] },
    ]);
    const feuilles = await lireFichier('f.xlsx', xlsx);
    expect(feuilles.map((f) => f.nom)).toEqual(['Nord', 'Sud']);
    expect(feuilles[0]?.lignes[1]).toEqual(['Atelier Fictif', 'a@atelier-fictif.test']);
  });

  it('lit un texte collé depuis un tableur', () => {
    const feuille = lireTexte('Société\tNom\nAtelier Fictif\tDurand');
    expect(feuille.lignes).toEqual([
      ['Société', 'Nom'],
      ['Atelier Fictif', 'Durand'],
    ]);
  });

  it('refuse un ancien .xls et un binaire inconnu avec un message clair', async () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00]);
    await expect(lireFichier('a.xls', xls)).rejects.toThrow(FichierIllisible);
    await expect(lireFichier('a.pdf', Buffer.from([0x25, 0x50, 0x00, 0x01]))).rejects.toThrow(
      /non pris en charge/,
    );
  });
});
