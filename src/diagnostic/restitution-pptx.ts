import PptxGenJSModule from 'pptxgenjs';
import type { Diapositive } from './schema.js';

// Les types décrivent l'espace de noms CommonJS ; Node ESM donne la classe elle-même.
const PptxGenJS = PptxGenJSModule as unknown as typeof PptxGenJSModule.default;

// Charte SIMATIS. Polices courantes de PowerPoint : Manrope et Source Sans ne sont pas installées
// sur tous les postes et le fichier doit s'ouvrir identique partout.
const MARINE = '0C376B';
const MENTHE = '9FF7E8';
const ENCRE = '0B2038';
const GRIS = '5B7180';
const POLICE = 'Calibri';

export const nomFichierDeck = (entreprise: string) =>
  `Restitution - ${
    entreprise
      .replace(/["/\\:*?<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'diagnostic'
  }.pptx`;

// Le texte de chaque diapositive est rendu tel que le deck l'affiche (une ligne = un paragraphe) ;
// les notes d'orateur vont dans les notes de PowerPoint. La mise en page est celle de la charte,
// pas une copie du rendu de l'artifact.
export async function genererDeckPptx({
  entreprise,
  diapositives,
}: {
  entreprise: string;
  diapositives: Diapositive[];
}): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `Restitution - ${entreprise}`;
  pptx.company = 'SIMATIS';

  diapositives.forEach((d, i) => {
    const slide = pptx.addSlide();
    const lignes = d.texte
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (i === 0) {
      slide.background = { color: MARINE };
      slide.addText(d.titre, {
        x: 0.8,
        y: 2.3,
        w: 11.7,
        h: 1.6,
        fontFace: POLICE,
        fontSize: 40,
        bold: true,
        color: 'FFFFFF',
        valign: 'bottom',
      });
      if (lignes.length > 0)
        slide.addText(lignes.join('\n'), {
          x: 0.8,
          y: 4.1,
          w: 11.7,
          h: 1.6,
          fontFace: POLICE,
          fontSize: 20,
          color: MENTHE,
          valign: 'top',
        });
    } else {
      slide.background = { color: 'FFFFFF' };
      slide.addShape('rect', {
        x: 0,
        y: 0,
        w: 0.25,
        h: 7.5,
        fill: { color: MARINE },
        line: { color: MARINE },
      });
      slide.addShape('rect', {
        x: 0.25,
        y: 0,
        w: 0.08,
        h: 7.5,
        fill: { color: MENTHE },
        line: { color: MENTHE },
      });
      slide.addText(d.titre, {
        x: 0.8,
        y: 0.45,
        w: 11.8,
        h: 1.1,
        fontFace: POLICE,
        fontSize: 30,
        bold: true,
        color: MARINE,
        valign: 'middle',
      });
      if (lignes.length > 0)
        slide.addText(
          lignes.map((l) => ({ text: l, options: { bullet: lignes.length > 1, breakLine: true } })),
          {
            x: 0.8,
            y: 1.8,
            w: 11.8,
            h: 4.7,
            fontFace: POLICE,
            fontSize: lignes.length > 7 ? 16 : 20,
            color: ENCRE,
            valign: 'top',
            paraSpaceAfter: 8,
            fit: 'shrink',
          },
        );
      slide.addText(`SIMATIS · ${entreprise}`, {
        x: 0.8,
        y: 6.95,
        w: 9,
        h: 0.3,
        fontFace: POLICE,
        fontSize: 10,
        color: GRIS,
      });
      slide.addText(String(i + 1), {
        x: 11.8,
        y: 6.95,
        w: 0.8,
        h: 0.3,
        fontFace: POLICE,
        fontSize: 10,
        color: GRIS,
        align: 'right',
      });
    }
    if (d.notes.trim()) slide.addNotes(d.notes);
  });

  return (await pptx.write({ outputType: 'uint8array' })) as Uint8Array;
}
