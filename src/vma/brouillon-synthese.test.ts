import { describe, expect, it } from 'vitest';
import {
  brouillonResultat,
  montantFrein,
  type EcranDirigeant,
  type SyntheseVma,
} from './brouillon.js';

// Données fictives : la synthèse telle que le site l'envoie en méthode 3.3.
const synthese = (extra: Partial<SyntheseVma> = {}): SyntheseVma => ({
  questions: ['Où en êtes-vous ?', 'Qu’est-ce qui vous freine ?', 'Par où commencer ?'],
  verdict: {
    cle: 'suspendu',
    titre: 'Verdict suspendu : deux chiffres se contredisent',
    phrase: '',
    points: [
      '100 devis pour 100 € : le nombre et le montant semblent confondus.',
      'Point fictif <b>.',
    ],
    remarques: ['Remarque fictive.'],
  },
  vmaLigne: 'vous en signez 2 k€ par mois : c’est votre VMA',
  pratiques: {
    auMax: 2,
    total: 5,
    titre: 'Vos pratiques sont solides : 2 sur 5 au meilleur niveau.',
    forces: ['Relance des devis', 'Fidélisation'],
  },
  freins: [
    {
      k: 'extension',
      n: 9,
      label: 'Ventes aux clients en place',
      titre: 'Les ventes à vos clients en place',
      phrase: 'Phrase.',
      nature: 'gain',
      enjeu: 400,
      hypothese: 'Si +10 % de volume.',
      debut: ['Étape A', 'Étape B'],
    },
    {
      k: 'fidelisation',
      n: 8,
      label: 'Fidélisation',
      titre: 'La fidélisation',
      phrase: 'Phrase.',
      nature: 'perteEvitee',
      enjeu: 200,
      hypothese: 'Si 10 % de départs évités.',
    },
    {
      k: 'contractualisation',
      n: 11,
      label: 'Forfaits engagés',
      titre: 'Les forfaits',
      phrase: 'Phrase.',
      nature: 'securise',
      enjeu: 3000,
      hypothese: '3 k€ par mois à sécuriser.',
    },
  ],
  autres: [],
  gainMensuel: 600,
  texteFreins:
    'Trois freins restent. Levés, ils rapporteraient environ +600 € par mois, soit 7,2 k€ par an.',
  texteAutres: null,
  noteMontants: 'Montants par mois : des ordres de grandeur.',
  action: {
    titre: 'Les ventes à vos clients en place',
    label: 'Ventes aux clients en place',
    debut: ['Étape A', 'Étape B'],
    sous: 'Le frein qui rapporte le plus.',
  },
  appel: 'Avant d’aller plus loin, vérifions vos chiffres ensemble : 15 minutes suffisent.',
  libelles: {
    engage: 'Sous contrat',
    regulier: 'Clients réguliers, sans contrat',
    ponctuel: 'Prestations ponctuelles',
  },
  ...extra,
});

const ecran = (s: SyntheseVma = synthese()): EcranDirigeant => ({
  entreprise: 'Atelier <Fictif>',
  methode: '3.3',
  periode: 3,
  parcours: 'standard',
  caMensuel: { total: 10000, regulier: 3000, engage: 5000, ponctuel: 2000 },
  objectif: { caMensuel: 12000, echeance: 1, partEngageeVisee: null, montantEngageMensuel: null },
  vma: 2000,
  mesurable: true,
  statut: 'prouvée',
  tenue: 'tenue',
  allureVisee: 12000,
  echeance: 1,
  niveau: { cle: 'ecart', label: 'Écart', phrase: 'Phrase.' },
  ecart: 2000,
  ecartPct: null,
  freins: [],
  textes: { definitionVma: 'D.', nonMesurable: 'N.', aucunFrein: 'A.' },
  synthese: s,
});

describe('mail de résultat, méthode 3.3 (trois questions)', () => {
  it('suit les trois questions, dans l’ordre', () => {
    const { html } = brouillonResultat({ contactNom: 'Jeanne DUPONT', ecran: ecran() });
    const i1 = html.indexOf('1 · Où en êtes-vous ?');
    const i2 = html.indexOf('2 · Qu’est-ce qui vous freine ?');
    const i3 = html.indexOf('3 · Par où commencer ?');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(html).toContain('Bonjour Jeanne,');
  });

  it('affiche le verdict, les points à vérifier et les remarques, échappés', () => {
    const { html } = brouillonResultat({ contactNom: null, ecran: ecran() });
    expect(html).toContain('Verdict suspendu : deux chiffres se contredisent');
    expect(html).toContain('Point fictif &lt;b&gt;.');
    expect(html).toContain('Remarque fictive.');
    expect(html).toContain('Atelier &lt;Fictif&gt;');
  });

  it('chiffre chaque frein avec son hypothèse, le revenu à sécuriser à part', () => {
    const { html } = brouillonResultat({ contactNom: null, ecran: ecran() });
    expect(html).toContain('+400');
    expect(html).toContain('préservés');
    expect(html).toContain('à sécuriser');
    expect(html).toContain('Si +10 % de volume.');
    expect(html).not.toContain('enjeu non chiffré');
    expect(html).not.toContain('*');
  });

  it('montre les forces et une seule action, puis l’échange de 15 minutes', () => {
    const { html } = brouillonResultat({ contactNom: null, ecran: ecran() });
    expect(html).toContain('✓ Relance des devis');
    expect(html).toContain('Étape A');
    expect(html).toContain('Échanger 15 minutes');
    expect(html).toContain('contact.html?objet=echange');
  });

  it('signature courte, sans le pied nuit répété', () => {
    const { html } = brouillonResultat({ contactNom: null, ecran: ecran() });
    expect(html).toContain('Marc Tabouret');
    expect(html).not.toContain('Conseil et formation</div>');
    expect(html).toContain('Vous recevez ce mail parce que vous avez passé le Test de VMA');
  });

  it('sans action ni frein : pas de bloc vide', () => {
    const s = synthese({
      freins: [],
      action: null,
      gainMensuel: 0,
      texteFreins: 'Aucun frein ne reste.',
    });
    const { html } = brouillonResultat({ contactNom: null, ecran: ecran(s) });
    expect(html).toContain('Aucun frein ne reste.');
    expect(html).not.toContain('Montants par mois');
  });

  it('montant affiché selon la nature', () => {
    const f = synthese().freins;
    expect(montantFrein(f[0]!)).toMatch(/^\+400/);
    expect(montantFrein(f[1]!)).toMatch(/préservés$/);
    expect(montantFrein(f[2]!)).toMatch(/à sécuriser$/);
    expect(montantFrein({ ...f[0]!, enjeu: null })).toBe('');
  });
});
