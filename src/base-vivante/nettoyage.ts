import { civiliteDuPrenom } from './prenoms.js';

export type Civilite = 'M.' | 'Mme';

// Homogeneous record: the only shape the living base accepts (docs/plans/2026-10-12-base-vivante.md).
export type Fiche = {
  entreprise: string | null;
  civilite: Civilite | null;
  civiliteDeduite: boolean;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  telephone: string | null;
  fonction: string | null;
  linkedin: string | null;
  domaine: string | null;
};

export const CHAMPS_BRUTS = [
  'entreprise',
  'civilite',
  'prenom',
  'nom',
  'nomComplet',
  'email',
  'telephone',
  'portable',
  'fonction',
  'linkedin',
] as const;
export type ChampBrut = (typeof CHAMPS_BRUTS)[number];
export type Brut = Partial<Record<ChampBrut, string | null | undefined>> & {
  civiliteDeduite?: boolean;
};

const sansAccent = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '');

export const texte = (s: string | null | undefined): string | null => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};

const FOURNISSEURS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.fr',
  'yahoo.com',
  'hotmail.fr',
  'hotmail.com',
  'outlook.fr',
  'outlook.com',
  'live.fr',
  'live.com',
  'msn.com',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'sfr.fr',
  'neuf.fr',
  'bbox.fr',
  'laposte.net',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'gmx.fr',
  'gmx.com',
  'aol.com',
]);

const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export function normaliserEmail(valeur: string | null | undefined): string | null {
  const t = texte(valeur);
  if (!t) return null;
  const entreChevrons = /<([^>]+)>/.exec(t)?.[1];
  const candidats = (entreChevrons ?? t).replace(/^mailto:/i, '').split(/[;,\s]+/);
  for (const c of candidats) {
    const email = c
      .replace(/^mailto:/i, '')
      .replace(/^[<(]+|[>).]+$/g, '')
      .toLowerCase();
    if (EMAIL.test(email)) return email;
  }
  return null;
}

export function normaliserTelephone(valeur: string | null | undefined): string | null {
  const t = texte(valeur);
  if (!t) return null;
  const premier = (t.split(/\s*(?:\/|;|,| ou )\s*/i)[0] ?? '').replace(/\(0\)/g, '');
  const international = /^\s*\+/.test(premier);
  let chiffres = premier.replace(/\D/g, '');
  if (!international && chiffres.startsWith('00')) {
    chiffres = chiffres.slice(2);
  } else if (!international) {
    if (chiffres.length === 10 && chiffres.startsWith('0')) chiffres = `33${chiffres.slice(1)}`;
    else if (chiffres.length === 9 && /^[1-9]/.test(chiffres)) chiffres = `33${chiffres}`;
    else return null;
  }
  // « +33 06 12… » : the trunk zero is not part of the international number.
  if (chiffres.startsWith('330')) chiffres = `33${chiffres.slice(3)}`;
  if (chiffres.startsWith('33')) return /^33[1-9]\d{8}$/.test(chiffres) ? `+${chiffres}` : null;
  return /^\d{8,15}$/.test(chiffres) && !chiffres.startsWith('0') ? `+${chiffres}` : null;
}

export function domaineDeEmail(email: string | null): string | null {
  const domaine = email?.split('@')[1] ?? null;
  return domaine && !FOURNISSEURS.has(domaine) ? domaine : null;
}

// « acme-industrie.fr » → « Acme Industrie » (only used when the file gives no company).
export function entrepriseDuDomaine(domaine: string): string | null {
  const labels = domaine.split('.');
  const label = labels[labels.length - 2];
  if (!label) return null;
  return label
    .split('-')
    .filter(Boolean)
    .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
    .join(' ');
}

export function normaliserLinkedin(valeur: string | null | undefined): string | null {
  const t = texte(valeur);
  if (!t) return null;
  const m = /linkedin\.com\/(in|company)\/([^/?#\s]+)/i.exec(t);
  return m ? `https://www.linkedin.com/${m[1]?.toLowerCase()}/${m[2]?.toLowerCase()}` : null;
}

export function normaliserCivilite(valeur: string | null | undefined): Civilite | null {
  const t = sansAccent((texte(valeur) ?? '').toLowerCase()).replace(/[.\s]/g, '');
  if (['m', 'mr', 'monsieur', 'mrs', 'sir', 'homme', 'h'].includes(t)) return 'M.';
  if (['mme', 'madame', 'mlle', 'mademoiselle', 'ms', 'miss', 'femme', 'f'].includes(t))
    return 'Mme';
  return null;
}

// Jean-Pierre, Marie Claire: each part capitalised, separators kept.
export function normaliserPrenom(valeur: string | null | undefined): string | null {
  const t = texte(valeur);
  if (!t) return null;
  return t
    .split(/([\s-]+)/)
    .map((m) => m.charAt(0).toLocaleUpperCase('fr') + m.slice(1).toLocaleLowerCase('fr'))
    .join('');
}

export function normaliserNom(valeur: string | null | undefined): string | null {
  const t = texte(valeur);
  return t ? t.toLocaleUpperCase('fr') : null;
}

const PARTICULES = new Set(['de', 'du', 'des', 'la', 'le', 'van', 'von', 'der', 'den', 'di', 'da']);
const TITRES = new Set(['m', 'mr', 'monsieur', 'mme', 'madame', 'mlle', 'mademoiselle']);

const estMajuscules = (m: string) => /\p{L}/u.test(m) && m === m.toLocaleUpperCase('fr');

// « Jean DUPONT », « DUPONT Jean », « Dupont, Jean », « Jean Dupont », « Mme Claire Martin ».
export function decouperNomComplet(valeur: string | null | undefined): {
  civilite: Civilite | null;
  prenom: string | null;
  nom: string | null;
} {
  let t = texte(valeur);
  if (!t) return { civilite: null, prenom: null, nom: null };
  let civilite: Civilite | null = null;
  const titre = /^(\p{L}+)\.?\s+(.*)$/u.exec(t);
  if (titre && TITRES.has(sansAccent((titre[1] ?? '').toLowerCase()))) {
    civilite = normaliserCivilite(titre[1]);
    t = titre[2] ?? '';
  }
  if (t.includes(',')) {
    const [nom, ...reste] = t.split(',');
    return { civilite, prenom: texte(reste.join(' ')), nom: texte(nom) };
  }
  const mots = t.split(' ');
  if (mots.length === 1) return { civilite, prenom: null, nom: mots[0] ?? null };
  const majuscules = mots.map((m) => estMajuscules(m) && !PARTICULES.has(m.toLowerCase()));
  const nbMaj = majuscules.filter(Boolean).length;
  if (nbMaj > 0 && nbMaj < mots.length) {
    const nom = mots.filter((m, i) => majuscules[i] || PARTICULES.has(m.toLowerCase()));
    const prenom = mots.filter((m, i) => !majuscules[i] && !PARTICULES.has(m.toLowerCase()));
    return { civilite, prenom: texte(prenom.join(' ')), nom: texte(nom.join(' ')) };
  }
  // No case clue: « Prénom Nom », unless only the last word is a known first name.
  const premier = mots[0] ?? '';
  const dernier = mots[mots.length - 1] ?? '';
  if (civiliteDuPrenom(premier) === null && civiliteDuPrenom(dernier) !== null) {
    return { civilite, prenom: dernier, nom: texte(mots.slice(0, -1).join(' ')) };
  }
  return { civilite, prenom: premier, nom: texte(mots.slice(1).join(' ')) };
}

export type Normalisation = { fiche: Fiche; avertissements: string[] };

// Idempotent: normalising an already homogeneous record gives it back unchanged.
export function normaliserFiche(brut: Brut): Normalisation {
  const avertissements: string[] = [];
  let prenom = normaliserPrenom(brut.prenom);
  let nom = normaliserNom(brut.nom);
  let civilite = normaliserCivilite(brut.civilite);
  if (brut.nomComplet && !prenom && !nom) {
    const decoupe = decouperNomComplet(brut.nomComplet);
    prenom = normaliserPrenom(decoupe.prenom);
    nom = normaliserNom(decoupe.nom);
    civilite ??= decoupe.civilite;
  }
  let civiliteDeduite = civilite !== null && brut.civiliteDeduite === true;
  if (!civilite && prenom) {
    civilite = civiliteDuPrenom(prenom);
    civiliteDeduite = civilite !== null;
  }

  const emailBrut = texte(brut.email);
  const email = normaliserEmail(emailBrut);
  if (emailBrut && !email) avertissements.push('Email invalide');
  // Landline first, then mobile: the record keeps a single number.
  const telBrut = texte(brut.telephone) ?? texte(brut.portable);
  const telephone = normaliserTelephone(brut.telephone) ?? normaliserTelephone(brut.portable);
  if (telBrut && !telephone) avertissements.push('Téléphone invalide');
  const domaine = domaineDeEmail(email);

  let entreprise = texte(brut.entreprise);
  if (!entreprise && domaine) {
    entreprise = entrepriseDuDomaine(domaine);
    if (entreprise) avertissements.push("Entreprise déduite du domaine de l'email");
  }

  return {
    fiche: {
      entreprise,
      civilite,
      civiliteDeduite,
      prenom,
      nom,
      email,
      telephone,
      fonction: texte(brut.fonction),
      linkedin: normaliserLinkedin(brut.linkedin),
      domaine,
    },
    avertissements,
  };
}

// Duplicate keys, strongest first: a file line and a stored record are the same person when any
// of their keys is equal (email, then LinkedIn, then first name + name + company).
export function clesDoublon(f: Fiche): string[] {
  const cles: string[] = [];
  if (f.email) cles.push(`e:${f.email}`);
  if (f.linkedin) cles.push(`l:${f.linkedin}`);
  if (f.prenom && f.nom) {
    const personne = `${sansAccent(f.prenom.toLowerCase())}|${sansAccent(f.nom.toLowerCase())}`;
    // Both company spellings: a record that later gains an email must still match its older self.
    const lieux = [f.domaine, sansAccent((f.entreprise ?? '').toLowerCase())].filter(Boolean);
    for (const lieu of lieux) cles.push(`n:${personne}|${lieu}`);
  }
  return cles;
}
