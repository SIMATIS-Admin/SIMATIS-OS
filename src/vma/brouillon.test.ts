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
  describe('méthode 3.0', () => {
    const v3 = (extra: Partial<EcranDirigeant> = {}): EcranDirigeant =>
      ecran({
        methode: '3.0',
        periode: 3,
        vma: 1300,
        caMensuel: { total: 29000, regulier: 22000, engage: 5000, ponctuel: 2000 },
        tauxObserve: 0.75,
        echeance: 2,
        allureVisee: 30000,
        objectif: {
          caMensuel: 30000,
          echeance: 2,
          partEngageeVisee: 0.3,
          montantEngageMensuel: 9000,
        },
        projection: {
          ca: 24000,
          caAvecReconduction: 27000,
          engage: 0,
          engageAvecReconduction: 2500,
          echu: 5000,
        },
        conclusionCa: {
          statut: 'non-couvert',
          manque: [],
          ecart: 6000,
          ecartAvecReconduction: 3000,
          ecartPct: 0.25,
        },
        composition: { statut: 'non-atteint', partVisee: 0.3, cible: 9000, partActuelle: 0.17 },
        niveau: { cle: 'ecart', label: 'Écart à combler', phrase: 'Phrase fictive.' },
        freins: [{ n: 1, titre: 'Frein ponctuel', phrase: 'Phrase.', enjeu: 333, nature: 'gain' }],
        freinsPortefeuille: [
          { n: 11, titre: 'Forfaits engagés', phrase: 'Phrase.', enjeu: null, nature: 'securise' },
        ],
        textes: {
          definitionVma: 'La VMA est votre rythme de commandes ponctuelles.',
          nonMesurable: 'Non mesurable.',
          aucunFrein: 'Aucun frein marqué.',
          libelleCaMensuel: 'Votre chiffre d’affaires mensuel',
          libellesRevenus: {
            regulier: 'Activité régulière à montant variable',
            engage: 'Revenus sous engagement',
            ponctuel: 'Prestations ponctuelles',
          },
          natures: {
            gain: 'Gain de chiffre d’affaires',
            securise: 'Revenu mieux sécurisé, sans gain de chiffre d’affaires',
            nonChiffre: 'Enjeu non chiffré',
          },
          noteEnjeu: 'Un ordre de grandeur.',
          conclusions: {
            titreCa: 'Votre objectif de chiffre d’affaires est-il couvert ?',
            titreComposition: 'Votre objectif sous engagement est-il atteint ?',
            ca: { 'non-couvert': 'Non : il manque du chiffre d’affaires.' },
            composition: { 'non-atteint': 'Non : un excédent de variable ne compense pas.' },
          },
        },
        ...extra,
      });

    it('ouvre sur le CA mensuel et ses trois catégories, la VMA ne désigne que le ponctuel', () => {
      const { html } = brouillonResultat({ contactNom: 'Jeanne', ecran: v3() });
      expect(html).toContain('Votre chiffre d’affaires mensuel');
      expect(html).toContain('29\u00a0k€');
      expect(html).toContain(
        'Activité régulière à montant variable : 22\u00a0k€ par mois (76\u00a0%)',
      );
      expect(html).toContain('Revenus sous engagement : 5\u00a0k€ par mois (17\u00a0%)');
      expect(html).toContain('sur vos prestations ponctuelles');
      expect(html).not.toContain('nouvelles affaires');
      expect(html).not.toContain('Nouvelles affaires');
      expect(html).toContain('un rapport de montants, pas votre taux de signature habituel');
    });

    it('sépare les deux conclusions et la reconduction', () => {
      const { html } = brouillonResultat({ contactNom: null, ecran: v3() });
      expect(html).toContain('Votre objectif de chiffre d’affaires est-il couvert ?');
      expect(html).toContain('Non : il manque du chiffre d’affaires.');
      expect(html).toContain('Votre objectif sous engagement est-il atteint ?');
      expect(html).toContain('un excédent de variable ne compense pas');
      expect(html).toContain('27\u00a0k€ avec la reconduction indiquée');
      expect(html).toContain(
        'Sans reconduction de vos engagements, il vous manquera 6\u00a0k€ par mois à l’échéance, soit 72\u00a0k€ par an (+25\u00a0% par rapport à votre trajectoire estimée).',
      );
    });

    it('ouvre sur une synthèse : verdict, écart et premier frein à lever', () => {
      const { html } = brouillonResultat({ contactNom: null, ecran: v3() });
      const debut = html.indexOf('En bref');
      const bref = html.slice(debut, html.indexOf('Votre chiffre d’affaires mensuel', debut));
      expect(html.indexOf('En bref')).toBeGreaterThan(-1);
      expect(bref).toContain('Écart à combler');
      expect(bref).toContain('Non : il manque du chiffre d’affaires.');
      expect(bref).toContain('il vous manquera 6\u00a0k€ par mois');
      expect(bref).toContain('Le premier frein à lever :');
      expect(bref).toContain('frein ponctuel.');
    });

    it('activité ponctuelle atteignable : nuance le « non » par le niveau, sans parler de reconduction', () => {
      const lancement = v3({
        parcours: 'lancement',
        caMensuel: { total: 0, regulier: 0, engage: 0, ponctuel: 0 },
        projection: {
          ca: 4000,
          caAvecReconduction: null,
          engage: 0,
          engageAvecReconduction: null,
          echu: 0,
        },
        conclusionCa: {
          statut: 'non-couvert',
          manque: [],
          ecart: 6000,
          ecartAvecReconduction: null,
          ecartPct: 1.5,
        },
        composition: { statut: 'non-demande' },
        niveau: { cle: 'real', label: 'Réaliste', phrase: 'Phrase fictive.' },
        freinsPortefeuille: [],
        textes: {
          ...v3().textes,
          conclusions: {
            ...v3().textes.conclusions!,
            ca: {
              'non-couvert': 'Non : il manque du chiffre d’affaires.',
              'non-couvert-atteignable': 'Pas encore à votre rythme actuel, mais atteignable.',
            },
          },
        },
      });
      const { html } = brouillonResultat({ contactNom: null, ecran: lancement });
      expect(html).toContain('Pas encore à votre rythme actuel, mais atteignable.');
      expect(html).not.toContain('Non : il manque du chiffre d’affaires.');
      expect(html).not.toContain('Sans reconduction');
      expect(html).toContain('Il vous manquera 6\u00a0k€ par mois à l’échéance');
      // Le parcours Lancement n'a pas de revenus sous engagement : la catégorie n'est pas affichée.
      expect(html).not.toContain('Revenus sous engagement');
    });

    it('porte le logo du Test de VMA dans l’en-tête et une ligne d’aperçu', () => {
      const { html } = brouillonResultat({ contactNom: null, ecran: v3() });
      expect(html).toContain('https://www.simatis.fr/assets/mail/logo-test-vma.png');
      expect(html).toContain('Écart à combler. Votre chiffre d’affaires mensuel');
    });

    it('résultat plus ancien sans texte nuancé : garde la conclusion d’origine', () => {
      const { html } = brouillonResultat({
        contactNom: null,
        ecran: v3({ niveau: { cle: 'amb', label: 'Ambitieux', phrase: 'Phrase fictive.' } }),
      });
      expect(html).toContain('Non : il manque du chiffre d’affaires.');
    });

    it('type chaque enjeu : en euros pour le ponctuel, non chiffré pour les contrats', () => {
      const { html } = brouillonResultat({ contactNom: null, ecran: v3() });
      expect(html).toContain('Gain de chiffre d’affaires estimé : environ +333\u00a0€ par mois*');
      expect(html).toContain(
        'Revenu mieux sécurisé, sans gain de chiffre d’affaires · enjeu non chiffré',
      );
      expect(html).toContain('Vos freins : prestations ponctuelles');
      expect(html).toContain('Vos freins : clients réguliers et contrats');
    });

    it('à confirmer : dit ce qui manque, sans verdict', () => {
      const { html } = brouillonResultat({
        contactNom: null,
        ecran: v3({
          conclusionCa: {
            statut: 'a-confirmer',
            manque: ['clients réguliers partis'],
            ecart: 6000,
            ecartAvecReconduction: null,
            ecartPct: 0.25,
          },
          textes: {
            ...v3().textes,
            conclusions: {
              ...v3().textes.conclusions!,
              ca: { 'a-confirmer': 'À confirmer : données insuffisantes.' },
            },
          },
        }),
      });
      expect(html).toContain('À confirmer : données insuffisantes.');
      expect(html).toContain('Ce qui manque pour conclure : clients réguliers partis.');
      expect(html).not.toContain('il vous manquera');
    });
  });
});
