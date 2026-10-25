import type { ContenuRapport } from '../rapport-word.js';

// Rapport entièrement fictif, pour les tests de mise en page et d'enregistrement.
export const contenuRapportFictif: ContenuRapport = {
  entreprise: 'Atelier Fictif Nord',
  dateDiagnostic: '12 octobre 2026',
  reference: 'FICTIF-20261012',
  destinataire: 'M. Alex Exemple, dirigeant d’Atelier Fictif Nord',
  essentiel: {
    intro: 'Atelier Fictif Nord a aujourd’hui un profil commercial de Sprinteur & Cie <test>.',
    notes: [
      { note: '7,5', theme: 'Outils et méthode', mention: 'Acquis, au-dessus du seuil de 6' },
      { note: '5,4', theme: 'Stratégie et régularité', mention: 'Le verrou à lever' },
      { note: '9,5', theme: 'Polyvalence', mention: 'Un atout très solide' },
    ],
    priorites: [
      {
        titre: 'Installer la feuille de route.',
        texte: 'La décliner par pôle en objectifs chiffrés.',
      },
      { titre: 'Préparer la suite.', texte: 'Un rebond après chaque mission.' },
    ],
    plan: [
      { quand: 'Court terme', objectif: 'Consolider les outils', enPlace: 'Un pipeline unique' },
      { quand: 'Moyen terme', objectif: 'Franchir le verrou', enPlace: 'Une cadence régulière' },
      { quand: 'Long terme', objectif: 'Consolider', enPlace: 'Une méthode transmissible' },
    ],
    proposition: 'Un premier cycle de six mois, cadré avec le comité de direction.',
  },
  contexte: [
    'Atelier Fictif Nord conçoit des objets imaginaires.',
    'Une vague d’activité est attendue.',
  ],
  resultats: {
    intro: 'Les outils sont au-dessus du seuil ; le frein est la régularité.',
    dimensions: [
      { nom: 'Outils et méthode', note: '7,5', constat: 'Au-dessus du seuil de 6.' },
      {
        nom: 'Stratégie, régularité et endurance',
        note: '5,4',
        constat: 'Sous le seuil : le verrou.',
      },
      { nom: 'Polyvalence', note: '9,5', constat: 'Très élevée.' },
    ],
    profil: {
      nom: 'Sprinteur',
      scores:
        'Outils et méthode 7,5     Stratégie et régularité 5,4     Polyvalence 9,5     Seuil 6',
      paragraphes: [
        'La stratégie est la première dimension sous le seuil.',
        'Il faut tenir dans la durée.',
      ],
    },
  },
  preconisations: {
    intro: 'Deux préconisations pour lever le verrou.',
    items: [
      {
        etiquette: 'Stratégie',
        titre: 'Décliner la stratégie',
        paragraphes: ['Formalisez le projet.'],
      },
      {
        etiquette: 'Fidélisation',
        titre: 'Préparer l’après-vague',
        paragraphes: ['Un rebond systématique.'],
      },
    ],
  },
  plan: {
    intro: ['Le plan vise le profil Ultra-endurant.'],
    horizons: [
      {
        quand: 'Court terme',
        titre: 'Consolider Outils et méthode',
        objectif: 'Préparer le franchissement du verrou.',
        actions: [{ bloc: '3. Information et outillage', action: 'Un seul pipeline.' }],
      },
      {
        quand: 'Moyen terme',
        titre: 'Franchir la stratégie',
        objectif: 'Passer de 5,4 à 6 au moins.',
        actions: [{ bloc: '1. Cible', action: 'Deux segments prioritaires.' }],
      },
      {
        quand: 'Long terme',
        titre: 'Consolider',
        objectif: 'Rendre la méthode transmissible.',
        actions: [{ bloc: '2. Types d’affaires visés', action: 'Fixer l’ordre de l’effort.' }],
      },
    ],
    indicateurs: ['Quatre ou cinq indicateurs au plus.'],
    nePasFaire: ['Pas d’embauche à temps plein.'],
  },
  conclusion: {
    paragraphes: ['Atelier Fictif Nord est un Sprinteur.'],
    propositionTitre: 'De Sprinteur à Marathonien',
    proposition: ['Une direction commerciale à temps partagé.'],
  },
};
