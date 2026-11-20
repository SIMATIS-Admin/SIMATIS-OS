import PDFDocument from 'pdfkit';
import { calculer } from './devis-contenu.js';
import { LOGO_PNG } from './devis-logo.js';
import type { Clause, LigneDevis } from './schema.js';

export type DevisPourPdf = {
  numero: string;
  createdAt: Date;
  validiteJours: number;
  entreprise: string | null;
  contact: string | null;
  adresse: string;
  titre: string;
  contexte: string;
  objectifs: string;
  inclus: string;
  exclu: string;
  livrables: string;
  debut: string | null;
  duree: string;
  lignes: LigneDevis[];
  remisePct: number;
  acomptePct: number;
  frais: 'refactures' | 'inclus';
  clauses: Clause[];
  tvaPct: number;
  mentions: string;
};

const NAVY = '#0C376B';
const GRIS = '#4A5B72';
const MARGE = 50;
const BAS_DE_PAGE = 770;
const HAUT_DU_PIED = 818;

// Plain spaces and ASCII minus only: the narrow no-break space of Intl and U+2212 are not in the
// PDF base font.
const eur = (n: number) => {
  const [entier = '0', dec = '00'] = n.toFixed(2).split('.');
  return `${entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
};
// A date-only value (« 2027-01-11 ») is read as written; an instant is shown as Paris time, like
// the on-screen preview, so a quote made at 00:30 is not dated the day before.
const jour = (d: Date, fuseau = 'UTC') =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: fuseau,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
const jourParis = (d: Date) => jour(d, 'Europe/Paris');
// The base PDF font reads Windows-1252 only: anything else would print as garbage.
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export const nettoyerTexte = (s: string) =>
  Array.from(
    s
      .replace(/[\u202f\u00a0\u2009]/g, ' ')
      .replace(/→/g, '->')
      .replace(/←/g, '<-')
      .replace(/≥/g, '>=')
      .replace(/≤/g, '<='),
  )
    .filter((c) => c === '\n' || (c >= ' ' && c.codePointAt(0)! <= 0xff) || WINANSI_EXTRA.has(c))
    .join('');
const lignesDe = (s: string) => s.split('\n').filter((x) => x.trim());

// The same blocks, in the same order, as the on-screen preview (web/src/pages/DevisApercu.tsx).
export function genererPdfDevis(brut: DevisPourPdf): Promise<Buffer> {
  const n = nettoyerTexte;
  const d: DevisPourPdf = {
    ...brut,
    entreprise: brut.entreprise === null ? null : n(brut.entreprise),
    contact: brut.contact === null ? null : n(brut.contact),
    adresse: n(brut.adresse),
    titre: n(brut.titre),
    contexte: n(brut.contexte),
    objectifs: n(brut.objectifs),
    inclus: n(brut.inclus),
    exclu: n(brut.exclu),
    livrables: n(brut.livrables),
    duree: n(brut.duree),
    mentions: n(brut.mentions),
    lignes: brut.lignes.map((l) => ({ ...l, libelle: n(l.libelle) })),
    clauses: brut.clauses.map((c) => ({ ...c, titre: n(c.titre), texte: n(c.texte) })),
  };
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGE,
      bufferPages: true,
      info: { Title: `Devis ${d.numero}`, Author: 'SIMATIS' },
    });
    const morceaux: Buffer[] = [];
    doc.on('data', (m: Buffer) => morceaux.push(m));
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);

    const largeur = doc.page.width - 2 * MARGE;
    // The legal footer sits at the bottom of every page: the body stops above it.
    const pied = d.mentions.trim();
    doc.font('Helvetica').fontSize(7.5);
    const hauteurPied = pied ? doc.heightOfString(pied, { width: largeur - 60 }) : 0;
    const bas = pied ? Math.min(BAS_DE_PAGE, HAUT_DU_PIED - hauteurPied - 14) : BAS_DE_PAGE;
    const place = (hauteur: number) => {
      if (doc.y + hauteur > bas) doc.addPage();
    };
    const titreSection = (t: string) => {
      place(40);
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(t.toUpperCase(), MARGE);
      doc
        .moveTo(MARGE, doc.y + 1)
        .lineTo(MARGE + largeur, doc.y + 1)
        .strokeColor('#DCE3EC')
        .stroke();
      doc.moveDown(0.4).font('Helvetica').fontSize(10).fillColor('#1B2A40');
    };
    const puces = (s: string) => {
      for (const l of lignesDe(s)) {
        place(16);
        doc.text(`•  ${l}`, MARGE + 8, undefined, { width: largeur - 8 });
      }
      doc.x = MARGE;
    };

    const t = calculer(d, d.tvaPct);
    const echeance = new Date(d.createdAt.getTime() + d.validiteJours * 864e5);

    // En-tête : logo à gauche, références du devis à droite.
    doc.image(LOGO_PNG, MARGE, MARGE - 6, { width: 130 });
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(NAVY)
      .text(`DEVIS ${d.numero}`, MARGE + largeur - 220, MARGE, { width: 220, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(GRIS)
      .text(`Émis le ${jourParis(d.createdAt)}`, { width: 220, align: 'right' })
      .text(`Valable jusqu’au ${jourParis(echeance)}`, { width: 220, align: 'right' });
    doc.y = Math.max(MARGE + 50, doc.y) + 22;
    doc.x = MARGE;

    // Destinataire et titre
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#1B2A40')
      .text(d.entreprise ?? '—', MARGE);
    doc.font('Helvetica').fontSize(10);
    if (d.adresse.trim()) doc.text(d.adresse.trim(), MARGE, undefined, { width: 260 });
    if (d.contact) doc.text(`À l’attention de ${d.contact}`, MARGE);
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text(d.titre, MARGE);
    doc.font('Helvetica').fontSize(10).fillColor('#1B2A40');

    if (d.contexte.trim() || d.objectifs.trim()) {
      titreSection('Contexte et objectifs');
      if (d.contexte.trim()) doc.text(d.contexte, MARGE, undefined, { width: largeur });
      puces(d.objectifs);
    }
    titreSection('Périmètre de la mission');
    doc.font('Helvetica-Bold').text('Inclus', MARGE).font('Helvetica');
    if (d.inclus.trim()) puces(d.inclus);
    else doc.text('À préciser', MARGE);
    doc.moveDown(0.3).font('Helvetica-Bold').fillColor('#8A3B2A').text('Exclu', MARGE);
    doc.font('Helvetica').fillColor('#1B2A40');
    if (d.exclu.trim()) puces(d.exclu);
    else doc.text('Non précisé', MARGE);
    if (d.livrables.trim()) {
      titreSection('Livrables');
      puces(d.livrables);
    }
    titreSection('Calendrier');
    doc.text(
      `Début : ${d.debut ? jour(new Date(d.debut)) : 'à préciser'} · Durée : ${d.duree || 'à préciser'}`,
      MARGE,
    );

    // Prix
    titreSection('Prix');
    const colonnes = [MARGE, MARGE + 270, MARGE + 340, MARGE + 420];
    const enTete = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1B2A40');
      doc.text('Prestation', colonnes[0], y, { width: 260 });
      doc.text('Qté', colonnes[1], y, { width: 65, align: 'right' });
      doc.text('PU HT', colonnes[2], y, { width: 75, align: 'right' });
      doc.text('Total HT', colonnes[3], y, {
        width: MARGE + largeur - colonnes[3]!,
        align: 'right',
      });
      doc.y = y + 16;
    };
    const ligneTableau = (cellules: string[]) => {
      doc.font('Helvetica').fontSize(9);
      // The row is measured first: a long label must move to the next page whole, never split
      // from its price columns.
      const h = Math.max(doc.heightOfString(cellules[0] ?? '', { width: 260 }), 12);
      if (doc.y + h + 4 > bas) {
        doc.addPage();
        enTete();
        doc.font('Helvetica').fontSize(9);
      }
      const y = doc.y;
      doc.text(cellules[0] ?? '', colonnes[0], y, { width: 260 });
      doc.text(cellules[1] ?? '', colonnes[1], y, { width: 65, align: 'right' });
      doc.text(cellules[2] ?? '', colonnes[2], y, { width: 75, align: 'right' });
      doc.text(cellules[3] ?? '', colonnes[3], y, {
        width: MARGE + largeur - colonnes[3]!,
        align: 'right',
      });
      doc.y = y + h + 4;
    };
    place(40);
    enTete();
    for (const l of d.lignes)
      ligneTableau([
        l.libelle || '…',
        `${l.quantite} ${l.unite}`,
        l.prixUnitaire === null ? 'à fixer' : eur(l.prixUnitaire),
        l.prixUnitaire === null ? '' : eur(l.prixUnitaire * l.quantite),
      ]);
    doc.moveDown(0.5);
    const total = (libelle: string, valeur: string, gras = false) => {
      place(18);
      const y = doc.y;
      doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      doc.text(libelle, MARGE + 270, y, { width: 150 });
      doc.text(valeur, MARGE + 420, y, { width: largeur - 420, align: 'right' });
      doc.y = y + 15;
    };
    if (d.remisePct > 0) total(`Remise ${d.remisePct} %`, `- ${eur(t.remise)}`);
    total('Total HT', eur(t.ht));
    total(`TVA ${d.tvaPct} %`, eur(t.tva));
    total('Total TTC', eur(t.ttc), true);
    if (d.acomptePct > 0) total(`Acompte ${d.acomptePct} % à la commande`, eur(t.acompte));
    doc.x = MARGE;
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        `Frais de déplacement : ${d.frais === 'inclus' ? 'inclus dans le prix.' : 'refacturés au réel, sur justificatifs.'}`,
        MARGE,
        doc.y + 6,
      );

    // Conditions de vente
    const actives = d.clauses.filter((c) => c.active);
    if (actives.length) {
      titreSection('Conditions de vente');
      doc.fontSize(8.5).fillColor('#3B4A60');
      actives.forEach((c, i) => {
        place(30);
        doc
          .font('Helvetica-Bold')
          .text(`${i + 1}. ${c.titre.replace(/[.\s]+$/, '')}. `, MARGE, undefined, {
            width: largeur,
            continued: true,
          })
          .font('Helvetica')
          .text(c.texte);
        doc.moveDown(0.3);
      });
    }

    // Signatures
    place(110);
    doc.moveDown(1.2).fontSize(10).fillColor('#1B2A40');
    const y = doc.y;
    const demi = (largeur - 20) / 2;
    doc.rect(MARGE, y, demi, 80).dash(3, { space: 3 }).strokeColor('#BBBBBB').stroke().undash();
    doc
      .rect(MARGE + demi + 20, y, demi, 80)
      .dash(3, { space: 3 })
      .stroke()
      .undash();
    doc.font('Helvetica-Bold').text('Pour SIMATIS', MARGE + 8, y + 8, { width: demi - 16 });
    doc.font('Helvetica').text('Date et signature', MARGE + 8, undefined, { width: demi - 16 });
    doc
      .font('Helvetica-Bold')
      .text(`Pour ${d.entreprise ?? 'le client'}`, MARGE + demi + 28, y + 8, { width: demi - 16 });
    doc
      .font('Helvetica')
      .text('Date, signature et mention « Bon pour accord »', MARGE + demi + 28, undefined, {
        width: demi - 16,
      });
    // Footer and page numbers, drawn last when the page count is known. The bottom margin is lifted
    // meanwhile: text below it would start a new page.
    const { count, start } = doc.bufferedPageRange();
    for (let i = start; i < start + count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc.fontSize(7.5).fillColor(GRIS).font('Helvetica');
      if (pied) {
        doc
          .moveTo(MARGE, HAUT_DU_PIED - 6)
          .lineTo(MARGE + largeur, HAUT_DU_PIED - 6)
          .lineWidth(0.5)
          .strokeColor('#DCE3EC')
          .stroke();
        doc.text(pied, MARGE, HAUT_DU_PIED, { width: largeur - 60 });
      }
      doc.text(`Page ${i - start + 1} / ${count}`, MARGE + largeur - 55, HAUT_DU_PIED, {
        width: 55,
        align: 'right',
        lineBreak: false,
      });
    }
    doc.end();
  });
}
