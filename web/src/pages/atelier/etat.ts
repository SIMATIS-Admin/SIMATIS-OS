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

const objet = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const texte = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const texteOuNombre = (v: unknown, d: number | string) =>
  typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? v : d;
const nature = (v: unknown): Nature =>
  typeof v === 'string' && v in NATURES ? (v as Nature) : 'hyp';
const entier = (v: unknown, min: number, max: number, d: number) =>
  typeof v === 'number' && Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : d;
// Indice dans une liste : hors bornes (ou pas un entier), la valeur par défaut.
const indice = (v: unknown, taille: number, d: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < taille
    ? v
    : Math.min(d, taille - 1);
// Liste d'objets : tout élément qui n'en est pas un est écarté ; sans liste valide, le repli.
const liste = <T>(v: unknown, vers: (o: Record<string, unknown>) => T, repli: T[]): T[] =>
  Array.isArray(v)
    ? v
        .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
        .map((x) => vers(x as Record<string, unknown>))
    : repli;
const textes = (v: unknown, n: number) =>
  Array.from({ length: n }, (_, i) => texte(Array.isArray(v) ? (v as unknown[])[i] : ''));

// Complète une sauvegarde ancienne ou partielle avec les valeurs de l'état vide, et ramène chaque
// champ à sa forme : un fichier importé peut porter n'importe quoi, l'écran ne doit pas en tomber.
// Les clés inconnues sont gardées telles quelles.
export function completer(brut: unknown): EtatAtelier {
  const base = etatVide();
  const r = objet(brut);
  if (Object.keys(r).length === 0) return base;
  const obj = objet(r.obj);
  const icps = liste(
    r.icps,
    (x): Icp => ({
      code: texte(x.code),
      name: texte(x.name),
      offer: texte(x.offer),
      icp: textes(x.icp, 7),
      persona: textes(x.persona, 7),
    }),
    base.icps,
  );
  const scenarios = liste(
    r.scenarios,
    (x): Scenario => ({
      name: texte(x.name),
      ca: texteOuNombre(x.ca, ''),
      pros: texte(x.pros),
      cons: texte(x.cons),
    }),
    base.scenarios,
  );
  const motors = liste(
    r.motors,
    (x): Moteur => ({ name: texte(x.name), desc: texte(x.desc) }),
    base.motors,
  );
  const lesIcps = icps.length > 0 ? icps : base.icps;
  const lesScenarios = scenarios.length > 0 ? scenarios : base.scenarios;
  const lesMoteurs = motors.length > 0 ? motors : base.motors;
  const item = (x: Record<string, unknown>) => ({ v: texte(x.v), tag: nature(x.tag) });
  return {
    ...r,
    v: 1,
    step: entier(r.step, 0, 5, 0),
    date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : base.date,
    notes: textes(r.notes, 6),
    diag: r.diag === 'a-faire' || r.diag === 'fait' ? r.diag : 'non-prevu',
    diagNote: texte(r.diagNote),
    vma: r.vma === 'passe' ? 'passe' : 'a-passer',
    vmaNote: texte(r.vmaNote),
    facts: liste(
      r.facts,
      (x): Fait => ({
        k: texte(x.k),
        v: texte(x.v),
        tag: nature(x.tag),
        src: texte(x.src),
        ...(x.prive === true ? { prive: true } : {}),
      }),
      [],
    ),
    identity: {
      effectif: texte(objet(r.identity).effectif),
      ca: texte(objet(r.identity).ca),
      clients: texte(objet(r.identity).clients),
    },
    ambition: {
      ca: texte(objet(r.ambition).ca),
      echeance: texte(objet(r.ambition).echeance),
      niveau: texte(objet(r.ambition).niveau),
      freins: texte(objet(r.ambition).freins),
    },
    swot:
      Array.isArray(r.swot) && r.swot.length > 0
        ? liste(
            r.swot,
            (q): Quadrant => ({ t: texte(q.t), items: liste(q.items, item, []) }),
            base.swot,
          )
        : base.swot,
    vision: { annee: texte(objet(r.vision).annee), phrase: texte(objet(r.vision).phrase) },
    scenarios: lesScenarios,
    scen: indice(r.scen, lesScenarios.length, 1),
    motors: lesMoteurs,
    motor: indice(r.motor, lesMoteurs.length, 0),
    save: liste(
      r.save,
      (x): CaseSave => ({ t: texte(x.t), q: texte(x.q), v: texte(x.v) }),
      base.save,
    ),
    modeleNote: texte(r.modeleNote),
    obj: {
      ca: texteOuNombre(obj.ca, base.obj.ca),
      part: texteOuNombre(obj.part, base.obj.part),
      panier: texteOuNombre(obj.panier, base.obj.panier),
      abo: texteOuNombre(obj.abo, base.obj.abo),
      mois: texteOuNombre(obj.mois, base.obj.mois),
      tx1: texteOuNombre(obj.tx1, base.obj.tx1),
      tx2: texteOuNombre(obj.tx2, base.obj.tx2),
      taux: texteOuNombre(obj.taux, base.obj.taux),
      ...(typeof obj.exemple === 'boolean' ? { exemple: obj.exemple } : {}),
    },
    icps: lesIcps,
    icp: indice(r.icp, lesIcps.length, 0),
    cab: { c: texte(objet(r.cab).c), a: texte(objet(r.cab).a), b: texte(objet(r.cab).b) },
    pistes: liste(
      r.pistes,
      (x): Piste => ({
        name: texte(x.name),
        origin: texte(x.origin),
        desc: texte(x.desc),
        on: x.on === true,
        note: texte(x.note),
      }),
      base.pistes,
    ),
    actions: liste(
      r.actions,
      (x): Action => ({
        q: entier(x.q, 0, 3, 0),
        bloc: texte(x.bloc),
        title: texte(x.title),
        owner: texte(x.owner),
        metric: texte(x.metric),
        on: x.on !== false,
      }),
      [],
    ),
  };
}
