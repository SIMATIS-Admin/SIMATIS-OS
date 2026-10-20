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
    expect(html).toContain('15\u00a0k€ de CA commandé par mois, soit 180\u00a0k€ par an.');
    expect(html).toContain('Il vous manque 5\u00a0k€ de CA commandé par mois (+33\u00a0%)');
    expect(html).toContain('Le temps de vente');
    expect(html).toContain('Bien à vous,');
    expect(html).not.toMatch(/\btu\b|\bte\b|\bton\b/);
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
