import { evaluer } from './completude.js';
import type { Correspondance } from './colonnes.js';
import {
  CHAMPS_BRUTS,
  clesDoublon,
  normaliserFiche,
  type Brut,
  type ChampBrut,
  type Fiche,
} from './nettoyage.js';
import type { StatutLigne } from './schema.js';
import type { Zone } from './completude.js';

export type LigneCalculee = {
  numero: number;
  brut: string[];
  complements: Record<string, string> | null;
  fiche: Fiche;
  statut: StatutLigne;
  zone: Zone | null;
  raison: string | null;
  avertissements: string[];
};

const CHAMP_CONNU = new Set<string>(CHAMPS_BRUTS);

export function brutDe(
  ligne: string[],
  correspondance: Correspondance,
  complements: Record<string, string> | null,
): Brut {
  const brut: Brut = {};
  for (const champ of CHAMPS_BRUTS) {
    const i = correspondance[champ];
    if (i !== undefined) brut[champ] = ligne[i];
  }
  for (const [champ, valeur] of Object.entries(complements ?? {}))
    if (CHAMP_CONNU.has(champ)) brut[champ as ChampBrut] = valeur;
  return brut;
}

export function calculerLigne(
  numero: number,
  brut: string[],
  correspondance: Correspondance,
  complements: Record<string, string> | null = null,
): LigneCalculee {
  const { fiche, avertissements } = normaliserFiche(brutDe(brut, correspondance, complements));
  const completude = evaluer(fiche);
  return {
    numero,
    brut,
    complements,
    fiche,
    statut: completude.etat === 'pret' ? 'pret' : 'sous_minimum',
    zone: completude.etat === 'pret' ? completude.zone : null,
    raison: completude.etat === 'pret' ? null : completude.raison,
    avertissements,
  };
}

const CHAMPS_A_FUSIONNER = [
  'entreprise',
  'prenom',
  'nom',
  'email',
  'telephone',
  'fonction',
  'linkedin',
] as const;

// Lines of the same file that describe the same person are merged into the first one: the later
// ones keep their place in the airlock, marked as duplicates, and only complete the first.
export function calculerLignes(
  lignes: { numero: number; brut: string[]; complements: Record<string, string> | null }[],
  correspondance: Correspondance,
): LigneCalculee[] {
  const calculees = lignes.map((l) =>
    calculerLigne(l.numero, l.brut, correspondance, l.complements),
  );
  const parCle = new Map<string, LigneCalculee>();
  for (const ligne of calculees) {
    if (ligne.statut === 'integre') continue;
    const premier = clesDoublon(ligne.fiche)
      .map((c) => parCle.get(c))
      .find((l) => l !== undefined);
    if (!premier) {
      for (const c of clesDoublon(ligne.fiche)) parCle.set(c, ligne);
      continue;
    }
    const brut: Brut = { civiliteDeduite: premier.fiche.civiliteDeduite };
    for (const champ of CHAMPS_A_FUSIONNER)
      brut[champ] = premier.fiche[champ] ?? ligne.fiche[champ];
    if (premier.fiche.civilite) brut.civilite = premier.fiche.civilite;
    else if (ligne.fiche.civilite && !ligne.fiche.civiliteDeduite) {
      brut.civilite = ligne.fiche.civilite;
      brut.civiliteDeduite = false;
    }
    const fusion = normaliserFiche(brut);
    const completude = evaluer(fusion.fiche);
    premier.fiche = fusion.fiche;
    premier.avertissements = [...new Set([...premier.avertissements, ...fusion.avertissements])];
    premier.statut = completude.etat === 'pret' ? 'pret' : 'sous_minimum';
    premier.zone = completude.etat === 'pret' ? completude.zone : null;
    premier.raison = completude.etat === 'pret' ? null : completude.raison;
    for (const c of clesDoublon(premier.fiche)) parCle.set(c, premier);
    ligne.statut = 'doublon_interne';
    ligne.zone = null;
    ligne.raison = `Doublon de la ligne ${premier.numero}`;
  }
  return calculees;
}
