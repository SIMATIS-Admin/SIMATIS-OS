// Contenu d'un atelier stratégique : même forme que la sauvegarde de l'outil d'origine, pour que
// l'import ne transforme rien. L'état vide est un squelette neutre : aucun texte de méthode.
export const ETAPES = [
  'Cadrage',
  'Diagnostic',
  'Modèle',
  'Objectifs',
  'Ciblage',
  'Feuille de route',
] as const;

export const NATURES = {
  fait: 'Fait sourcé',
  decl: 'Déclaration',
  hyp: 'Hypothèse',
  open: 'Question ouverte',
} as const;
export type Nature = keyof typeof NATURES;

// Trajectoire du chiffre d'affaires sur les quatre trimestres, en pourcentage de l'objectif.
export const POIDS_TRIMESTRES = [10, 20, 30, 40] as const;
export const CLES_ICP = [
  'Catégorie',
  'Localisation',
  'Contexte',
  'Maturité',
  'Objectif',
  'Sensibilité prix',
  'Décision',
];
export const CLES_PERSONA = [
  'Poste',
  'Objectifs',
  'Craintes',
  'Souffrances',
  'Chemin d’achat',
  'Objections',
  'Déclencheur',
];

export type Fait = { k: string; v: string; tag: Nature; src: string; prive?: boolean };
export type Quadrant = { t: string; items: { v: string; tag: Nature }[] };
export type Scenario = { name: string; ca: number | string; pros: string; cons: string };
export type Moteur = { name: string; desc: string };
export type CaseSave = { t: string; q: string; v: string };
export type Objectifs = {
  ca: number | string;
  part: number | string;
  panier: number | string;
  abo: number | string;
  mois: number | string;
  tx1: number | string;
  tx2: number | string;
  taux: number | string;
  exemple?: boolean;
};
export type Icp = { code: string; name: string; offer: string; icp: string[]; persona: string[] };
export type Piste = { name: string; origin: string; desc: string; on: boolean; note: string };
export type Action = {
  q: number;
  bloc: string;
  title: string;
  owner: string;
  metric: string;
  on: boolean;
};

export type EtatAtelier = {
  v: 1;
  step: number;
  date: string;
  notes: string[];
  diag: 'non-prevu' | 'a-faire' | 'fait';
  diagNote: string;
  vma: 'a-passer' | 'passe';
  vmaNote: string;
  facts: Fait[];
  identity: { effectif: string; ca: string; clients: string };
  ambition: { ca: string; echeance: string; niveau: string; freins: string };
  swot: Quadrant[];
  vision: { annee: string; phrase: string };
  scen: number;
  scenarios: Scenario[];
  motor: number;
  motors: Moteur[];
  save: CaseSave[];
  modeleNote: string;
  obj: Objectifs;
  icp: number;
  icps: Icp[];
  cab: { c: string; a: string; b: string };
  pistes: Piste[];
  actions: Action[];
};

const sept = () => Array.from({ length: 7 }, () => '');

export function etatVide(): EtatAtelier {
  return {
    v: 1,
    step: 0,
    date: new Date().toISOString().slice(0, 10),
    notes: ['', '', '', '', '', ''],
    diag: 'non-prevu',
    diagNote: '',
    vma: 'a-passer',
    vmaNote: '',
    facts: [],
    identity: { effectif: '', ca: '', clients: '' },
    ambition: { ca: '', echeance: '', niveau: '', freins: '' },
    swot: ['Forces', 'Faiblesses', 'Opportunités', 'Menaces'].map((t) => ({ t, items: [] })),
    vision: { annee: '', phrase: '' },
    scen: 1,
    scenarios: [
      { name: 'Prudent', ca: '', pros: '', cons: '' },
      { name: 'Cible', ca: '', pros: '', cons: '' },
      { name: 'Ambitieux', ca: '', pros: '', cons: '' },
    ],
    motor: 0,
    motors: [
      { name: 'Offre 1', desc: '' },
      { name: 'Offre 2', desc: '' },
      { name: 'Offre 3', desc: '' },
    ],
    save: ['Solutions', 'Access', 'Value', 'Engagement'].map((t) => ({ t, q: '', v: '' })),
    modeleNote: '',
    obj: {
      ca: 100000,
      part: 30,
      panier: 2000,
      abo: 200,
      mois: 6,
      tx1: 25,
      tx2: 15,
      taux: 10,
      exemple: true,
    },
    icp: 0,
    icps: [{ code: 'ICP A', name: '', offer: '', icp: sept(), persona: sept() }],
    cab: { c: '', a: '', b: '' },
    pistes: Array.from({ length: 7 }, (_, i) => ({
      name: `Piste ${i + 1}`,
      origin: '',
      desc: '',
      on: false,
      note: '',
    })),
    actions: [],
  };
}

// Complète une sauvegarde ancienne ou partielle avec les valeurs de l'état vide (fusion
// superficielle, comme l'outil d'origine), sans jamais lire autre chose qu'un objet.
export function completer(brut: unknown): EtatAtelier {
  const base = etatVide();
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return base;
  const recu = brut as Partial<EtatAtelier>;
  return {
    ...base,
    ...recu,
    obj: { ...base.obj, ...(recu.obj ?? {}) },
  };
}
