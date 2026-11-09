import { CODES_NAF, DEPARTEMENTS } from './valeurs.js';

export const CODES_EFFECTIF = [
  'NN',
  '00',
  '01',
  '02',
  '03',
  '11',
  '12',
  '21',
  '22',
  '31',
  '32',
  '41',
  '42',
  '51',
  '52',
  '53',
] as const;
export const CATEGORIES = ['PME', 'ETI', 'GE'] as const;

// A sector is a NAF division (2 digits, all its codes) or one exact NAF code.
export type Secteur = { code: string; libelle: string };

export type Criteres = {
  q?: string;
  secteurs: Secteur[];
  departements: string[];
  effectifs: string[];
  categories: string[];
  caMin?: number;
  caMax?: number;
};

export const CRITERES_VIDES: Criteres = {
  secteurs: [],
  departements: [],
  effectifs: [],
  categories: [],
};

export const codesNafDe = (secteurs: Secteur[]): string[] => {
  const codes = new Set<string>();
  for (const { code } of secteurs) {
    if (/^\d\d$/.test(code))
      CODES_NAF.filter((c) => c.startsWith(`${code}.`)).forEach((c) => codes.add(c));
    else if (CODES_NAF.includes(code)) codes.add(code);
  }
  return [...codes];
};

const unique = <T>(l: T[]): T[] => [...new Set(l)];

// Whatever came from the AI or the form: only values the directory accepts go through.
export function criteresValides(brut: Partial<Record<keyof Criteres, unknown>>): Criteres {
  const liste = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const montant = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
  const secteurs = (Array.isArray(brut.secteurs) ? brut.secteurs : []).flatMap((s: unknown) => {
    const { code, libelle } = (s ?? {}) as Partial<Secteur>;
    return typeof code === 'string' && codesNafDe([{ code, libelle: '' }]).length > 0
      ? [{ code, libelle: typeof libelle === 'string' ? libelle : code }]
      : [];
  });
  const c: Criteres = {
    secteurs,
    departements: unique(
      liste(brut.departements)
        .map((d) => d.trim().toUpperCase())
        .filter((d) => DEPARTEMENTS.includes(d)),
    ),
    effectifs: unique(
      liste(brut.effectifs).filter((e) => (CODES_EFFECTIF as readonly string[]).includes(e)),
    ),
    categories: unique(
      liste(brut.categories).filter((e) => (CATEGORIES as readonly string[]).includes(e)),
    ),
  };
  const q = typeof brut.q === 'string' ? brut.q.trim().slice(0, 100) : '';
  if (q) c.q = q;
  const caMin = montant(brut.caMin);
  const caMax = montant(brut.caMax);
  if (caMin !== undefined) c.caMin = caMin;
  if (caMax !== undefined) c.caMax = caMax;
  return c;
}

// Only active companies are searched. A search with no criterion at all would list the whole
// register (and the directory caps any search at 10 000 results): it is refused.
export function versParametres(c: Criteres): URLSearchParams {
  const p = new URLSearchParams();
  const naf = codesNafDe(c.secteurs);
  if (c.q) p.set('q', c.q);
  if (naf.length > 0) p.set('activite_principale', naf.join(','));
  if (c.departements.length > 0) p.set('departement', c.departements.join(','));
  if (c.effectifs.length > 0) p.set('tranche_effectif_salarie', c.effectifs.join(','));
  if (c.categories.length > 0) p.set('categorie_entreprise', c.categories.join(','));
  if (c.caMin !== undefined) p.set('ca_min', String(c.caMin));
  if (c.caMax !== undefined) p.set('ca_max', String(c.caMax));
  if ([...p.keys()].length === 0) throw new Error('Indiquez au moins un critère de recherche.');
  p.set('etat_administratif', 'A');
  return p;
}
