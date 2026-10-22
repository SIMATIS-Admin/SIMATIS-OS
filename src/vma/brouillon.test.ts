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
  it('v2.3 : parcours Lancement, VMA prévisionnelle sur une échéance de 6 mois', () => {
    const { html } = brouillonResultat({
      contactNom: null,
      ecran: ecran({
        vma: 10000,
        statut: 'prévisionnelle',
        pastille: 'prévisionnelle',
        previsionnel: true,
        indicatif: true,
        parcours: 'lancement',
        echeance: 0.5,
        textes: {
          definitionVma: 'Définition.',
          nonMesurable: 'Non mesurable.',
          aucunFrein: 'Aucun frein marqué.',
          libelleVmaPrev: 'Votre VMA prévisionnelle',
          pastillePrev: 'Chiffres prévisionnels',
          indicatif: 'Résultat indicatif : peu de devis.',
        },
      }),
    });
    expect(html).toContain('Votre VMA prévisionnelle');
    expect(html).toContain('de CA commandé par mois attendu sur vos nouvelles affaires');
    expect(html).toContain('chiffres prévisionnels');
    expect(html).toContain('dans 6 mois');
    expect(html).toContain('Résultat indicatif : peu de devis.');
  });

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
    expect(html).toContain('Marc Tabouret');
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

  it('v2.1 : reprend pour chaque frein la réponse, la pratique avancée, par où commencer et le signe', () => {
    const { html } = brouillonResultat({
      contactNom: null,
      ecran: ecran({
        freins: [
          {
            n: 1,
            titre: 'Frein fictif',
            phrase: 'Phrase fictive.',
            enjeu: 3750,
            reponse: 'Réponse fictive',
            cible: 'Pratique fictive',
            debut: ['Action une.', 'Action <deux>.'],
            signe: 'Signe fictif.',
          },
        ],
        textes: {
          definitionVma: 'Définition.',
          nonMesurable: 'Non mesurable.',
          aucunFrein: 'Aucun frein marqué.',
          libelleReponse: 'Votre réponse',
          libelleCible: 'Les plus avancés',
          libelleDebut: 'Par où commencer',
          libelleSigne: 'Signe que c’est en place',
          libelleEnjeu: 'Enjeu estimé',
          noteEnjeu: 'Note fictive.',
        },
      }),
    });
    expect(html).toContain('Votre réponse : « Réponse fictive »');
    expect(html).toContain('Les plus avancés : « Pratique fictive »');
    expect(html).toContain('>Action une.</li>');
    expect(html).toContain('>Action &lt;deux&gt;.</li>');
    expect(html).toContain('Signe que c’est en place : Signe fictif.');
    expect(html).toContain('Enjeu estimé : environ +3,8\u00a0k€ par mois*');
    expect(html).toContain('* Note fictive.</div>');
  });

  it("n'annonce jamais le potentiel, réservé à Marc", () => {
    const { html } = brouillonResultat({ contactNom: null, ecran: ecran() });
    expect(html).not.toMatch(/potentiel|gain|multiplicateur/i);
    expect(html).toContain('>Bonjour,</p>');
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

  describe('v2.2 : mode portefeuille', () => {
    const portefeuille = (extra: Partial<EcranDirigeant> = {}) =>
      ecran({
        vma: 14000,
        recurrent: 80000,
        allureActuelle: 94000,
        trajectoire: 84000,
        socleEcheance: 80000,
        allureVisee: 150000,
        ecart: 66000,
        modePortefeuille: true,
        partRecActuelle: 0.85,
        partRecVisee: 0.9,
        recurrentCible: 135000,
        spotCible: 15000,
        spotEcheance: 4000,
        ecartRecurrent: 55000,
        ecartSpot: 11000,
        freinsConquete: [{ n: 1, titre: 'Frein de conquête', phrase: 'Phrase conquête.' }],
        freinsPortefeuille: [
          { n: 8, titre: 'Frein de portefeuille', phrase: 'Phrase portefeuille.' },
        ],
        textes: {
          definitionVma: 'Définition.',
          nonMesurable: 'Non mesurable.',
          aucunFrein: 'Aucun frein marqué.',
          libelleAllureTotale: 'Votre allure commerciale',
          titreConquete: 'Conquête',
          titrePortefeuille: 'Portefeuille',
          libelleSocleRecurrent: 'Socle récurrent',
          libelleNouvellesAffaires: 'Nouvelles affaires',
        },
        ...extra,
      });

    it('ouvre sur l’allure totale décomposée, puis deux sections', () => {
      const { html } = brouillonResultat({ contactNom: null, ecran: portefeuille() });
      expect(html).toContain('Votre allure commerciale');
      expect(html).not.toContain('Votre VMA commerciale');
      expect(html).toContain('94\u00a0k€');
      expect(html).toContain('Socle récurrent : 80\u00a0k€ par mois');
      expect(html).toContain('Nouvelles affaires : 14\u00a0k€ par mois');
      expect(html).toContain('Conquête');
      expect(html).toContain('Portefeuille');
      expect(html).toContain('Frein de conquête');
      expect(html).toContain('Frein de portefeuille');
      expect(html).toContain('votre cible est de 135\u00a0k€ par mois');
    });

    it('reste comme avant sans mode portefeuille', () => {
      const { html } = brouillonResultat({ contactNom: null, ecran: ecran() });
      expect(html).toContain('Votre VMA commerciale');
      expect(html).not.toContain('Conquête');
    });

    it('se rend sans exception quand les listes de freins manquent', () => {
      const { html } = brouillonResultat({
        contactNom: null,
        ecran: portefeuille({ freinsConquete: undefined, freinsPortefeuille: undefined }),
      });
      expect(html).toContain('Votre allure commerciale');
    });
  });
});
