import { CHAMPS_BRUTS, type ChampBrut } from './nettoyage.js';

export type ChampCible = ChampBrut;
export { CHAMPS_BRUTS as CHAMPS_CIBLES };

export const LIBELLES_CHAMPS: Record<ChampBrut, string> = {
  entreprise: 'Entreprise',
  civilite: 'Civilité',
  prenom: 'Prénom',
  nom: 'Nom',
  nomComplet: 'Prénom et nom ensemble',
  email: 'Email',
  telephone: 'Téléphone',
  fonction: 'Fonction',
  linkedin: 'LinkedIn',
};

// Field index in the file, by target field. Absent = the file has no such column.
export type Correspondance = Partial<Record<ChampBrut, number>>;

export const normaliserEntete = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Whole-header synonyms (already normalised).
const SYNONYMES: Record<ChampBrut, string[]> = {
  entreprise: [
    'entreprise',
    'societe',
    'raison sociale',
    'nom entreprise',
    'nom de l entreprise',
    'nom societe',
    'nom de la societe',
    'organisation',
    'company',
    'company name',
    'compagnie',
    'etablissement',
    'structure',
    'denomination',
  ],
  civilite: ['civilite', 'titre', 'genre', 'sexe', 'gender', 'mr mme', 'm mme', 'madame monsieur'],
  prenom: ['prenom', 'prenom contact', 'first name', 'firstname', 'given name'],
  nom: ['nom', 'nom contact', 'nom de famille', 'last name', 'lastname', 'surname', 'family name'],
  nomComplet: [
    'nom prenom',
    'prenom nom',
    'nom et prenom',
    'prenom et nom',
    'contact',
    'nom complet',
    'full name',
    'name',
    'interlocuteur',
    'dirigeant',
    'decideur',
    'responsable',
  ],
  email: [
    'email',
    'e mail',
    'mail',
    'courriel',
    'adresse mail',
    'adresse email',
    'adresse e mail',
    'mail pro',
    'email pro',
    'e mail pro',
    'email professionnel',
    'mail professionnel',
    'email address',
    'work email',
  ],
  telephone: [
    'telephone',
    'tel',
    'tel direct',
    'tel fixe',
    'tel mobile',
    'telephone direct',
    'telephone fixe',
    'telephone mobile',
    'ligne directe',
    'mobile',
    'portable',
    'phone',
    'phone number',
    'direct phone',
    'numero de telephone',
    'numero',
    'gsm',
  ],
  fonction: [
    'fonction',
    'poste',
    'titre du poste',
    'intitule du poste',
    'job title',
    'title position',
    'position',
    'metier',
    'qualite',
    'role',
  ],
  linkedin: [
    'linkedin',
    'url linkedin',
    'lien linkedin',
    'profil linkedin',
    'linkedin url',
    'linkedin profile',
    'profile url',
  ],
};

// Looser fallbacks on a fragment of the header, tried in this order.
const FRAGMENTS: [RegExp, ChampBrut][] = [
  [/linkedin/, 'linkedin'],
  [/mail|courriel/, 'email'],
  [/\b(tel|phone|mobile|portable|gsm)\b|telephone/, 'telephone'],
  [/societe|entreprise|raison sociale|company|organisation/, 'entreprise'],
  [/prenom|first/, 'prenom'],
  [/fonction|poste|job|title/, 'fonction'],
  [/civilite/, 'civilite'],
  [/^nom\b|\bnom$|last name/, 'nom'],
];

export function champDeEntete(entete: string): ChampBrut | null {
  const n = normaliserEntete(entete);
  if (!n) return null;
  for (const champ of CHAMPS_BRUTS) if (SYNONYMES[champ].includes(n)) return champ;
  for (const [re, champ] of FRAGMENTS) if (re.test(n)) return champ;
  return null;
}

// A header row is recognised by the number of cells that name a known field.
export const scoreEntete = (cellules: string[]): number =>
  cellules.filter((c) => champDeEntete(c) !== null).length;

// Row index of the header, looking under title rows; null when nothing looks like one.
export function trouverEntete(lignes: string[][]): number | null {
  let meilleur: number | null = null;
  let meilleurScore = 0;
  lignes.slice(0, 25).forEach((l, i) => {
    const score = scoreEntete(l);
    if (score > meilleurScore) {
      meilleur = i;
      meilleurScore = score;
    }
  });
  return meilleurScore >= 2 || (meilleurScore === 1 && meilleur === 0) ? meilleur : null;
}

// What the OS remembers per source: normalised header → field (or null = ignored column).
export type MemoireColonnes = Record<string, ChampBrut | null>;

export type Proposition = {
  correspondance: Correspondance;
  // Columns no field was found for, to be mapped by hand (or by Claude later).
  inconnues: number[];
};

export function proposerCorrespondance(
  entetes: string[],
  memoire: MemoireColonnes = {},
): Proposition {
  const correspondance: Correspondance = {};
  const inconnues: number[] = [];
  const dejaPris = (champ: ChampBrut) => correspondance[champ] !== undefined;
  entetes.forEach((entete, i) => {
    const n = normaliserEntete(entete);
    if (!n) return;
    if (n in memoire) {
      const champ = memoire[n];
      if (champ && !dejaPris(champ)) correspondance[champ] = i;
      return;
    }
    const champ = champDeEntete(entete);
    if (champ && !dejaPris(champ)) correspondance[champ] = i;
    else if (!champ) inconnues.push(i);
  });
  // Separate first name and name columns make the combined one useless.
  if (correspondance.prenom !== undefined && correspondance.nom !== undefined)
    delete correspondance.nomComplet;
  return { correspondance, inconnues };
}

export function memoireDe(entetes: string[], correspondance: Correspondance): MemoireColonnes {
  const memoire: MemoireColonnes = {};
  const parIndex = new Map<number, ChampBrut>();
  for (const champ of CHAMPS_BRUTS) {
    const i = correspondance[champ];
    if (i !== undefined) parIndex.set(i, champ);
  }
  entetes.forEach((entete, i) => {
    const n = normaliserEntete(entete);
    if (n) memoire[n] = parIndex.get(i) ?? null;
  });
  return memoire;
}
