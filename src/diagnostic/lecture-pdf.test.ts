import { describe, expect, it } from 'vitest';
import type { Grille } from './grille.js';
import {
  itemsDuPdf,
  LectureImpossible,
  lignesDuRapport,
  reponsesDuRapport,
  type ItemTexte,
} from './lecture-pdf.js';

// Rapport fictif : les éléments de texte sont placés comme dans le PDF de l'outil (question à
// gauche en x=270, réponse en x=600 sous l'en-tête « Réponse »).
const XQ = 270;
const XR = 600;
const item = (page: number, y: number, x: number, texte: string): ItemTexte => ({
  page,
  x,
  y,
  texte,
});
const entete = [item(1, 1100, 100, 'RÉPONSES DONNÉES'), item(1, 1090, XR + 10, 'Réponse')];
const ligne = (page: number, y: number, question: string, reponse: string[]): ItemTexte[] => [
  item(page, y, 100, 'Axe fictif'),
  item(page, y, XQ, question),
  ...reponse.map((r, i) => item(page, y - i * 16, XR, r)),
];

const grille: Grille = {
  seuil: 6,
  questions: [
    { section: 'R1', numero: 1, libelle: 'Q1', dimension: 'outils', poids: 2 },
    { section: 'R2', numero: 4, libelle: 'Q2', dimension: 'strategie', poids: 1 },
  ],
};
const correspondance = [
  { rapport: '1.1', section: 'R1', numero: 1, motCle: 'plan d’action écrit' },
  { rapport: '2.3', section: 'R2', numero: 4, motCle: 'réseau' },
];

describe('Lecture du rapport PDF de l’outil externe', () => {
  it('lit un pictogramme par question, et N/A quand il n’y en a pas', () => {
    const items = [
      ...entete,
      ...ligne(1, 1000, '1.1 Existe-t-il un plan d’action écrit ?', ['✅', 'Oui, écrit']),
      ...ligne(1, 960, '1.2 Deuxième question', ['❕', 'Oui, mais']),
      ...ligne(1, 920, '1.3 Troisième question', ['❗']),
      ...ligne(1, 880, '1.4 Quatrième question', ['❌']),
      ...ligne(1, 840, '1.5 Taux de transformation', ['Non suivi ou non applicable']),
    ];
    expect(lignesDuRapport(items).map((l) => [l.numero, l.lettre])).toEqual([
      ['1.1', 'A'],
      ['1.2', 'B'],
      ['1.3', 'C'],
      ['1.4', 'D'],
      ['1.5', 'N/A'],
    ]);
  });

  it('rattache la réponse sur plusieurs lignes à sa question, d’une page à l’autre', () => {
    const items = [
      ...entete,
      item(1, 1000, XQ, '1.1 Question sur'),
      item(1, 984, XQ, 'deux lignes ?'),
      item(1, 1000, XR, '❗'),
      item(1, 984, XR, 'Peu prise en compte'),
      item(1, 60, 100, 'https://exemple.test/rapport'),
      item(1, 40, XR + 150, '3/14'),
      item(2, 1000, XQ, '1.2 Question de la page suivante ?'),
      item(2, 1000, XR, '❌'),
    ];
    const lignes = lignesDuRapport(items);
    expect(lignes[0]).toMatchObject({
      numero: '1.1',
      question: '1.1 Question sur deux lignes ?',
      lettre: 'C',
    });
    expect(lignes[0]!.reponse).not.toContain('3/14');
    expect(lignes[1]).toMatchObject({ numero: '1.2', lettre: 'D' });
  });

  it('refuse un PDF sans tableau de réponses', () => {
    expect(() => lignesDuRapport([item(1, 100, 100, 'Autre document')])).toThrow(LectureImpossible);
  });

  it('refuse une réponse qui n’est ni un pictogramme ni « non applicable »', () => {
    const items = [...entete, ...ligne(1, 1000, '1.1 Question ?', ['Oui, sans pictogramme'])];
    expect(() => lignesDuRapport(items)).toThrow(/non reconnue/);
  });

  it('applique la correspondance et vérifie que la question est celle attendue', () => {
    const lignes = lignesDuRapport([
      ...entete,
      ...ligne(1, 1000, '1.1 Un plan d’action écrit existe-t-il ?', ['✅']),
      ...ligne(1, 960, '2.3 Le réseau est-il actif ?', ['❗']),
    ]);
    expect(reponsesDuRapport(lignes, correspondance, grille)).toEqual([
      { section: 'R1', numero: 1, reponse: 'A' },
      { section: 'R2', numero: 4, reponse: 'C' },
    ]);
  });

  it('refuse quand la numérotation du rapport a changé ou qu’une question manque', () => {
    const decalee = lignesDuRapport([
      ...entete,
      ...ligne(1, 1000, '1.1 Une autre question ?', ['✅']),
      ...ligne(1, 960, '2.3 Le réseau est-il actif ?', ['❗']),
    ]);
    expect(() => reponsesDuRapport(decalee, correspondance, grille)).toThrow(/pas celle attendue/);
    const incomplete = lignesDuRapport([
      ...entete,
      ...ligne(1, 1000, '1.1 Un plan d’action écrit ?', ['✅']),
    ]);
    expect(() => reponsesDuRapport(incomplete, correspondance, grille)).toThrow(/absente/);
  });

  it('refuse une correspondance qui vise une question hors de la grille', () => {
    const lignes = lignesDuRapport([
      ...entete,
      ...ligne(1, 1000, '1.1 Un plan d’action écrit ?', ['✅']),
    ]);
    expect(() =>
      reponsesDuRapport(
        lignes,
        [{ rapport: '1.1', section: 'R9', numero: 9, motCle: 'plan' }],
        grille,
      ),
    ).toThrow(/absente de la grille/);
  });

  it('extrait le texte et sa position d’un vrai PDF', async () => {
    const items = await itemsDuPdf(pdfMinimal('Bonjour fictif'));
    expect(items).toEqual([expect.objectContaining({ page: 1, texte: 'Bonjour fictif' })]);
    await expect(itemsDuPdf(new TextEncoder().encode('%PDF-1.4 fictif'))).rejects.toThrow();
  });
});

// PDF d'une page avec une ligne de texte (police standard), pour tester l'extraction.
function pdfMinimal(texte: string): Uint8Array {
  const flux = `BT /F1 12 Tf 72 700 Td (${texte}) Tj ET`;
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const positions: number[] = [];
  objets.forEach((o, i) => {
    positions.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const p of positions) pdf += `${String(p).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
