import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { contenuRapportFictif } from './fixtures/rapport-fictif.js';
import { contenuRapportSchema, genererRapportWord } from './rapport-word.js';

const ouvrir = (contenu = contenuRapportFictif) =>
  unzipSync(genererRapportWord(contenu, new Date('2026-10-25T10:00:00Z')));

describe('Rapport Word', () => {
  it('produit un fichier Word complet : parties du gabarit, logo et document', () => {
    const f = ouvrir();
    for (const nom of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/styles.xml',
      'word/header1.xml',
      'word/footer1.xml',
      'word/media/logo.png',
    ])
      expect(f[nom], nom).toBeDefined();
    // Signature PNG du logo.
    expect([...f['word/media/logo.png']!.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(strFromU8(f['[Content_Types].xml']!)).not.toContain('comments');
  });

  it('reprend le contenu dans l ordre des sections, avec l entreprise en couverture et en en-tête', () => {
    const f = ouvrir();
    const doc = strFromU8(f['word/document.xml']!);
    const ordre = [
      'Atelier Fictif Nord</w:t>',
      'L’essentiel',
      'Notre démarche',
      'Le contexte d’Atelier Fictif Nord',
      'Résultats du diagnostic',
      'Préconisations',
      'Plan d’action commercial',
      'Conclusion et prochaine étape',
      'Bien à vous,',
    ].map((t) => doc.indexOf(t));
    expect(ordre.every((n) => n >= 0)).toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    expect(doc).toContain('RÉFÉRENCE FICTIF-20261012');
    expect(doc).toContain('DIAGNOSTIC RÉALISÉ LE 12 OCTOBRE 2026');
    expect(strFromU8(f['word/header1.xml']!)).toContain('ATELIER FICTIF NORD');
  });

  it('échappe le texte pour garder un XML valide', () => {
    const doc = strFromU8(ouvrir()['word/document.xml']!);
    expect(doc).toContain('Sprinteur &amp; Cie &lt;test&gt;');
    expect(doc).not.toContain('<test>');
  });

  it('met en avant la dimension sous le seuil', () => {
    const doc = strFromU8(ouvrir()['word/document.xml']!);
    expect(doc.indexOf('E8F7F3')).toBeGreaterThan(doc.indexOf('7,5'));
    expect(doc.indexOf('E8F7F3')).toBeLessThan(doc.indexOf('Stratégie et régularité'));
  });

  it('omet la section « ne fera pas » quand elle est vide', () => {
    const contenu = {
      ...contenuRapportFictif,
      plan: { ...contenuRapportFictif.plan, nePasFaire: [] },
    };
    expect(strFromU8(ouvrir(contenu)['word/document.xml']!)).not.toContain('ne fera pas');
  });

  it('refuse un contenu incomplet', () => {
    expect(contenuRapportSchema.safeParse({ entreprise: 'X' }).success).toBe(false);
  });
});
