import { describe, expect, it } from 'vitest';
import { brouillonResultat, type EcranDirigeant } from './brouillon.js';

const ecran = (extra: Partial<EcranDirigeant> = {}): EcranDirigeant => ({
  entreprise: 'Atelier Fictif',
  vma: 15000,
  mesurable: true,
  statut: 'prouvée',
  tenue: 'tenue',
  allureVisee: 20000,
  echeance: 2,
  niveau: { cle: 'real', label: 'Réaliste', phrase: 'Phrase fictive.' },
  ecart: 5000,
  ecartPct: 0.33,
  freins: [{ n: 1, titre: 'Le temps de vente', phrase: 'Le temps est peu protégé.' }],
  textes: {
    definitionVma: 'Définition.',
    nonMesurable: 'Non mesurable.',
    aucunFrein: 'Aucun frein marqué.',
  },
  ...extra,
});

describe('brouillon du résultat au dirigeant', () => {
  it('reprend le résultat du dirigeant, en vouvoyant et avec la signature de Marc', () => {
    const { subject, html } = brouillonResultat({ contactNom: 'Jeanne', ecran: ecran() });
    expect(subject).toBe('Votre résultat au Test de VMA');
    expect(html).toContain('Bonjour Jeanne,');
    expect(html).toContain(
      '15\u00a0k€ de CA commandé par mois sur vos nouvelles affaires, soit 180\u00a0k€ par an.',
    );
    expect(html).toContain('Il vous manque 5\u00a0k€ de CA commandé par mois (+33\u00a0%)');
    expect(html).toContain('Le temps de vente');
    expect(html).toContain('Bien à vous,');
    expect(html).not.toMatch(/\btu\b|\bte\b|\bton\b/);
  });

  it('montre le socle récurrent et l’allure actuelle quand il y en a un', () => {
    const { html } = brouillonResultat({
      contactNom: null,
      ecran: ecran({
        recurrent: 8000,
        allureActuelle: 23000,
        ecart: -3000,
        ecartPct: null,
        niveau: { cle: 'deja', label: 'Déjà à votre allure', phrase: 'Phrase.' },
      }),
    });
    expect(html).toContain('+ socle récurrent : 8\u00a0k€ par mois');
    expect(html).toContain('= allure actuelle : 23\u00a0k€ par mois, soit 276\u00a0k€ par an.');
    expect(html).toContain('Vous dépassez déjà votre objectif de 3\u00a0k€ par mois.');
  });

  it('v2.0 : avec une trajectoire, l’écart se lit à l’échéance, sur la lancée', () => {
    const { html } = brouillonResultat({
      contactNom: null,
      ecran: ecran({
        vma: 15000,
        recurrent: 8000,
        allureActuelle: 23000,
        trajectoire: 19826.68,
        socleEcheance: 4826.68,
        allureVisee: 20000,
        ecart: 173.32,
        ecartPct: 0.01,
      }),
    });
    expect(html).toContain(
      'Sans rien changer, votre socle récurrent passerait de 8\u00a0k€ à 4,8\u00a0k€ par mois dans 2 ans.',
    );
    expect(html).toContain(
      'Sur votre lancée, il vous manquera 173\u00a0€ par mois à l’échéance (+1\u00a0%)',
    );
    expect(html).toContain('Où se perd votre allure :');
    expect(html).not.toContain('Il vous manque');
  });

  it("n'annonce jamais le potentiel, réservé à Marc", () => {
    const { html } = brouillonResultat({ contactNom: null, ecran: ecran() });
    expect(html).not.toMatch(/potentiel|gain|multiplicateur/i);
    expect(html.startsWith('<p>Bonjour,</p>')).toBe(true);
  });

  it('échappe le nom de l’entreprise et les textes saisis', () => {
    const { html } = brouillonResultat({
      contactNom: '<script>x</script>',
      ecran: ecran({ entreprise: 'A & B <i>' }),
    });
    expect(html).toContain('A &amp; B &lt;i&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('dit clairement quand la VMA n’est pas mesurable', () => {
    const { html } = brouillonResultat({
      contactNom: null,
      ecran: ecran({
        vma: null,
        mesurable: false,
        ecart: null,
        ecartPct: null,
        statut: 'non mesurable',
      }),
    });
    expect(html).toContain('Non mesurable.');
  });
});
