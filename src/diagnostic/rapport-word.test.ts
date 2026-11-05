import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { contenuRapportFictif, contenuRapportFictifV3 } from './fixtures/rapport-fictif.js';
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

  describe('structure v3', () => {
    const doc = () => strFromU8(ouvrir(contenuRapportFictifV3)['word/document.xml']!);

    it('range les nouveaux blocs dans l ordre du rapport', () => {
      const d = doc();
      const ordre = [
        'Résultats du diagnostic',
        'THÈME',
        'Préconisations',
        'DÉMARRAGE',
        'Plan d’action commercial',
        'RÉSULTAT ATTENDU',
        'Les indicateurs à suivre',
        'Les conditions de réussite',
        'Conclusion et prochaine étape',
        'Mon intervention',
        'Qui fait quoi',
        'Bien à vous,',
        'Pour aller plus loin',
        'A. Suivre les devis',
        'B. Trier les demandes',
      ].map((t) => d.indexOf(t));
      expect(
        ordre.every((n) => n >= 0),
        ordre.join(),
      ).toBe(true);
      expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    });

    it('fait varier les colonnes du tableau d actions selon les champs renseignés', () => {
      const d = doc();
      // Horizon 1 : quand + action + résultat ; horizon 3 : bloc + action seulement.
      expect(d).toContain('>QUAND<');
      expect(d).toContain('>BLOC DE LA MÉTHODE<');
      expect(d.match(/>RÉSULTAT ATTENDU</g)).toHaveLength(2);
    });

    it('met en tableau les thèmes en nombre libre et les tableaux des blocs', () => {
      const d = doc();
      expect(d).toContain('Fichier de prospects');
      expect(d).toContain('>INTERVENANT<');
      expect(d).toContain('>LA QUESTION À SE POSER<');
    });

    it('omet récapitulatif, conditions, blocs et annexes quand ils ne sont pas renseignés', () => {
      const d = strFromU8(ouvrir()['word/document.xml']!);
      for (const t of ['DÉMARRAGE', 'Les conditions de réussite', 'Pour aller plus loin'])
        expect(d, t).not.toContain(t);
    });

    it('relit un rapport enregistré avant ces blocs (sans les nouveaux champs)', () => {
      const ancien = JSON.parse(JSON.stringify(contenuRapportFictif)) as Record<string, unknown>;
      const plan = ancien.plan as Record<string, unknown>;
      delete plan.conditions;
      delete (ancien.conclusion as Record<string, unknown>).blocs;
      delete ancien.annexes;
      const lu = contenuRapportSchema.safeParse(ancien);
      expect(lu.success).toBe(true);
      if (lu.success) expect(lu.data.annexes).toEqual([]);
    });

    it('refuse un tableau dont une ligne n a pas autant de cellules que d en-têtes', () => {
      const mauvais = structuredClone(contenuRapportFictifV3);
      mauvais.annexes[1]!.tableau!.lignes = [['Budget', 'Une seule cellule de trop']];
      expect(contenuRapportSchema.safeParse(mauvais).success).toBe(false);
    });
  });

  it('refuse un contenu incomplet', () => {
    expect(contenuRapportSchema.safeParse({ entreprise: 'X' }).success).toBe(false);
  });
});
