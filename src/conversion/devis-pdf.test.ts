import { getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { itemsDuPdf } from '../diagnostic/lecture-pdf.js';
import { genererPdfDevis, nettoyerTexte, type DevisPourPdf } from './devis-pdf.js';

const base: DevisPourPdf = {
  numero: 'DEV-2026-001',
  createdAt: new Date('2026-11-19T10:00:00Z'),
  validiteJours: 30,
  entreprise: 'Exemple Industrie',
  contact: 'Camille Exemple',
  adresse: '12 rue Fictive\n71200 Ville Fictive',
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

describe('nettoyerTexte', () => {
  it('garde le français et l’euro, remplace les flèches et espaces fines, retire le reste', () => {
    expect(nettoyerTexte('Été à Paris : « 1\u202f200 € »')).toBe('Été à Paris : « 1 200 € »');
    expect(nettoyerTexte('a → b ≥ c')).toBe('a -> b >= c');
    expect(nettoyerTexte('ok ✓ 😀 fin')).toBe('ok   fin');
  });
});

describe('genererPdfDevis, papier en-tête', () => {
  it('porte le logo, sans l’ancien en-tête texte, et l’adresse du destinataire', async () => {
    const buf = await genererPdfDevis(base);
    expect(buf.toString('latin1')).toContain('/Subtype /Image');
    const t = await texte(base);
    expect(t).not.toContain('Direction commerciale à temps partagé');
    expect(t).toContain('12 rue Fictive');
    expect(t).toContain('71200 Ville Fictive');
    expect(t).toContain('À l’attention de Camille Exemple');
  });

  it('répète les mentions légales en pied de chaque page', async () => {
    const lignes = Array.from({ length: 60 }, (_, i) => ({
      libelle: `Ligne ${i + 1}`,
      unite: 'forfait' as const,
      quantite: 1,
      prixUnitaire: 100,
    }));
    const items = await itemsDuPdf(new Uint8Array(await genererPdfDevis({ ...base, lignes })));
    const pages = new Set(items.map((i) => i.page));
    expect(pages.size).toBeGreaterThan(1);
    const pagesAvecPied = new Set(
      items.filter((i) => i.texte.includes('Société fictive')).map((i) => i.page),
    );
    expect(pagesAvecPied).toEqual(pages);
    const pied = items.find((i) => i.texte.includes('Société fictive'))!;
    for (const i of items.filter((x) => /^Ligne \d+$/.test(x.texte)))
      expect(i.page === pied.page ? Math.abs(i.y - pied.y) > 12 : true).toBe(true);
  });

  it('n’imprime pas de pied de page quand les mentions sont vides', async () => {
    const t = await texte({ ...base, mentions: '  ' });
    expect(t).not.toContain('Société fictive');
  });

  it('omet l’adresse et l’attention quand elles sont vides', async () => {
    const t = await texte({ ...base, adresse: '', contact: null });
    expect(t).not.toContain('l’attention');
    expect(t).toContain('Exemple Industrie');
  });
});

describe('genererPdfDevis, mise en page', () => {
  it('ne casse pas le tableau quand un long libellé tombe en bas de page', async () => {
    const lignes = [
      ...Array.from({ length: 13 }, (_, i) => ({
        libelle: `Ligne ${i + 1}`,
        unite: 'forfait' as const,
        quantite: 1,
        prixUnitaire: 100,
      })),
      {
        libelle: 'LONGLIBELLE ' + 'mot '.repeat(135),
        unite: 'forfait' as const,
        quantite: 1,
        prixUnitaire: 777,
      },
    ];
    const items = await itemsDuPdf(new Uint8Array(await genererPdfDevis({ ...base, lignes })));
    const debut = items.find((i) => i.texte.startsWith('LONGLIBELLE'))!;
    const prix = items.find((i) => i.texte === '777,00 €')!;
    expect(prix.page).toBe(debut.page);
    expect(Math.abs(prix.y - debut.y)).toBeLessThan(3);
  });

  it('répète l’en-tête du tableau sur chaque page', async () => {
    const lignes = Array.from({ length: 60 }, (_, i) => ({
      libelle: `Ligne ${i + 1}`,
      unite: 'forfait' as const,
      quantite: 1,
      prixUnitaire: 100,
    }));
    const items = await itemsDuPdf(new Uint8Array(await genererPdfDevis({ ...base, lignes })));
    const pagesAvecLignes = new Set(
      items.filter((i) => /^Ligne \d+$/.test(i.texte)).map((i) => i.page),
    );
    const pagesAvecEntete = new Set(
      items.filter((i) => i.texte === 'Prestation').map((i) => i.page),
    );
    expect(pagesAvecLignes.size).toBeGreaterThan(1);
    for (const p of pagesAvecLignes) expect(pagesAvecEntete.has(p)).toBe(true);
  });

  it('date le devis à l’heure de Paris et ne double pas le point d’un titre de clause', async () => {
    const t = await texte({
      ...base,
      createdAt: new Date('2026-11-19T23:30:00Z'),
      clauses: [{ titre: 'Paiement.', texte: 'À 30 jours.', active: true }],
    });
    expect(t).toContain('Émis le 20/11/2026');
    expect(t).not.toContain('Paiement. .');
    expect(t).toContain('1. Paiement.');
  });
});
