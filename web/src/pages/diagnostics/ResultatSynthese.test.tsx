// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SyntheseVma, TestVma } from '../../api.js';
import { questionsEchange, ResultatSynthese } from './ResultatSynthese.js';

afterEach(cleanup);

// Données fictives (dépôt public) : un résultat en méthode 3.3.
const synthese: SyntheseVma = {
  questions: ['Où en êtes-vous ?', 'Qu’est-ce qui vous freine ?', 'Par où commencer ?'],
  verdict: {
    cle: 'suspendu',
    titre: 'Verdict suspendu : deux chiffres se contredisent',
    phrase: '',
    points: ['Point A.', 'Point B.'],
    remarques: ['Remarque C.'],
  },
  vmaLigne: 'vous en signez 2 k€ par mois : c’est votre VMA',
  pratiques: {
    auMax: 1,
    total: 3,
    titre: 'Une pratique sur trois au meilleur niveau.',
    forces: ['Relance des devis'],
  },
  freins: [
    {
      k: 'extension',
      n: 9,
      label: 'Ventes aux clients en place',
      titre: 'Les ventes',
      phrase: 'P.',
      nature: 'gain',
      enjeu: 400,
      hypothese: 'Hypothèse fictive.',
      debut: ['Étape A'],
      reponse: 'Souvent',
      cible: 'Toujours',
    },
  ],
  autres: [],
  gainMensuel: 400,
  texteFreins: 'Un frein reste.',
  texteAutres: null,
  noteMontants: 'Ordres de grandeur.',
  action: {
    titre: 'Les ventes',
    label: 'Ventes aux clients en place',
    debut: ['Étape A'],
    sous: 'Commencez par lui.',
  },
  appel: 'Échangeons.',
  libelles: {
    engage: 'Sous contrat',
    regulier: 'Clients réguliers, sans contrat',
    ponctuel: 'Prestations ponctuelles',
  },
};

const test = (): TestVma => ({
  id: 't1',
  entrepriseId: null,
  entrepriseNom: 'Atelier Fictif',
  contactNom: null,
  contactEmail: null,
  tutoiement: false,
  envoyeeLe: null,
  relances: [],
  echecEnvoi: null,
  mailOuvertLe: null,
  lienOuvertLe: null,
  type: 'premier',
  statut: 'utilisee',
  lien: 'https://exemple.test',
  expireLe: '2026-12-01',
  creeLe: '2026-11-01',
  recueLe: '2026-11-02',
  version: '3.3',
  resultat: {
    entreprise: 'Atelier Fictif',
    methode: '3.3',
    periode: 3,
    caMensuel: { total: 10000, regulier: 3000, engage: 5000, ponctuel: 2000 },
    objectif: { caMensuel: 9000, echeance: 1, partEngageeVisee: 1, montantEngageMensuel: 9000 },
    alertes: [
      { code: 'devis-unitaire', nombre: 100, montant: 100 },
      { code: 'dernier-mois', valeur: 3000, moyenne: 1000 },
      { code: 'objectif-inferieur' },
    ],
    vma: 2000,
    mesurable: true,
    statut: 'prouvée',
    tenue: 'tenue',
    allureVisee: 9000,
    echeance: 1,
    niveau: { cle: 'deja', label: 'Couvert', phrase: 'P.' },
    ecart: -1000,
    freins: [],
    synthese,
  },
  reponses: {
    periode: 3,
    ambition: { caActuel: 50000, caVise: 108000, echeance: 1 },
    chiffres: {
      regulier: 9000,
      regulierDernier: 3000,
      engageMin: 5000,
      ponctuel: 6000,
      devisNb: 100,
      devisMontant: 100,
      taux: 50,
    },
    estimes: { devisNb: true },
    freins: { relance: 4, extension: 3, regularite: 2 },
    freinsEcartes: ['temps'],
  },
  calcul: {
    freins: [
      { n: 7, label: 'Relance des devis', note: 4, bloc: 'x' },
      { n: 9, label: 'Ventes aux clients en place', note: 3, bloc: 'x' },
    ],
  },
});

describe('résultat 3.3 dans l’OS', () => {
  it('montre à gauche les trois questions, comme le mail', () => {
    render(<ResultatSynthese test={test()} />);
    expect(screen.getByText('1 · Où en êtes-vous ?')).toBeTruthy();
    expect(screen.getByText('Verdict suspendu : deux chiffres se contredisent')).toBeTruthy();
    expect(screen.getByText('3 · Par où commencer ?')).toBeTruthy();
    expect(screen.getByText('Hypothèse fictive.')).toBeTruthy();
    expect(screen.getAllByText(/\+400/).length).toBeGreaterThan(0);
  });

  it('prépare l’échange à droite, hors export PDF', () => {
    const { container } = render(<ResultatSynthese test={test()} />);
    expect(screen.getByText('À vérifier avec le dirigeant')).toBeTruthy();
    expect(screen.getByText('Questions pour l’échange')).toBeTruthy();
    expect(screen.getByText('Ses pratiques')).toBeTruthy();
    expect(screen.getByText('Ses chiffres saisis')).toBeTruthy();
    expect(container.querySelector('[data-pdf-exclude] .rs-marc')).toBeTruthy();
  });

  it('surligne les chiffres suspects et signale les estimés', () => {
    const { container } = render(<ResultatSynthese test={test()} />);
    const suspects = [...container.querySelectorAll('.rs-saisie tr.ko')].map(
      (tr) => tr.textContent,
    );
    expect(suspects.some((x) => x?.includes('Devis envoyés'))).toBe(true);
    expect(suspects.some((x) => x?.includes('dont le dernier mois'))).toBe(true);
    expect(screen.getByText('estimé')).toBeTruthy();
    expect(screen.getByText(/1 question écartée/)).toBeTruthy();
  });

  it('tire les questions de l’échange des points à vérifier', () => {
    const qs = questionsEchange(test().resultat!, test().reponses);
    expect(qs[0]).toMatch(/combien de devis ponctuels/);
    expect(qs.some((q) => /par mois, ou sur 3 mois/.test(q))).toBe(true);
    expect(qs.some((q) => /un plancher, ou votre vraie ambition/.test(q))).toBe(true);
    expect(qs.some((q) => /sous contrat : combien de clients/.test(q))).toBe(true);
    expect(qs.at(-1)).toMatch(/^Ventes aux clients en place/);
  });

  it('ne rend rien sans synthèse (résultats plus anciens)', () => {
    const t = test();
    delete t.resultat!.synthese;
    const { container } = render(<ResultatSynthese test={t} />);
    expect(container.textContent).toBe('');
  });
});
