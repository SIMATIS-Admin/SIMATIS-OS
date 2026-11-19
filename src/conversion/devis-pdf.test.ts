import { getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { itemsDuPdf } from '../diagnostic/lecture-pdf.js';
import { genererPdfDevis, type DevisPourPdf } from './devis-pdf.js';

const base: DevisPourPdf = {
  numero: 'DEV-2026-001',
  createdAt: new Date('2026-11-19T10:00:00Z'),
  validiteJours: 30,
  entreprise: 'Exemple Industrie',
  contact: 'Camille Exemple',
  titre: 'Diagnostic fictif',
  contexte: 'Contexte fictif de la mission.',
  objectifs: 'Mesurer le niveau\nDécider d’un plan',
  inclus: 'Entretiens\nRapport écrit',
  exclu: 'Recrutement',
  livrables: 'Un rapport',
  debut: '2027-01-11',
  duree: '6 semaines',
  lignes: [
    { libelle: 'Cadrage et entretiens', unite: 'forfait', quantite: 1, prixUnitaire: 1800 },
    { libelle: 'Analyse', unite: 'jour', quantite: 2, prixUnitaire: 450 },
  ],
  remisePct: 10,
  acomptePct: 30,
  frais: 'refactures',
  clauses: [
    { titre: 'Paiement', texte: 'Facture à 30 jours.', active: true },
    { titre: 'Clause désactivée', texte: 'Ne doit pas apparaître.', active: false },
  ],
  tvaPct: 20,
  mentions: 'Société fictive\n1 rue Fictive',
};

const texte = async (d: DevisPourPdf) =>
  (await itemsDuPdf(new Uint8Array(await genererPdfDevis(d)))).map((i) => i.texte).join(' ');

describe('genererPdfDevis', () => {
  it('produit un PDF avec le numéro, le client, les lignes et les totaux', async () => {
    const buf = await genererPdfDevis(base);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const t = await texte(base);
    for (const attendu of [
      'DEV-2026-001',
      'Exemple Industrie',
      'Camille Exemple',
      'Diagnostic fictif',
      'Cadrage et entretiens',
      'Analyse',
      'Total TTC',
      '2 916,00',
      '- 270,00',
      'TVA 20 %',
      'Société fictive',
      'Bon pour accord',
    ])
      expect(t).toContain(attendu);
  });

  it('reprend les clauses actives et laisse les clauses désactivées', async () => {
    const t = await texte(base);
    expect(t).toContain('Paiement');
    expect(t).toContain('Facture à 30 jours.');
    expect(t).not.toContain('Clause désactivée');
  });

  it('tient un texte accentué, des apostrophes et un prix à fixer', async () => {
    const t = await texte({
      ...base,
      titre: 'L’été d’Éléonore : « mission »',
      lignes: [{ libelle: 'Étude à venir', unite: 'forfait', quantite: 1, prixUnitaire: null }],
    });
    expect(t).toContain('Éléonore');
    expect(t).toContain('à fixer');
  });

  it('passe sur plusieurs pages quand il y a beaucoup de lignes', async () => {
    const lignes = Array.from({ length: 60 }, (_, i) => ({
      libelle: `Ligne numéro ${i + 1}`,
      unite: 'forfait' as const,
      quantite: 1,
      prixUnitaire: 100,
    }));
    const buf = await genererPdfDevis({ ...base, lignes });
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    expect(pdf.numPages).toBeGreaterThan(1);
    expect(await texte({ ...base, lignes })).toContain('Ligne numéro 60');
  });
});
