import type { NoeudCerveau } from './cerveau.js';

// Les deux notes du Drive qui portent l'organigramme de l'OS (ce qui existe) et ses prochaines étapes.
// Le journal détaillé des livraisons (simatis-os-structure.md) reste en archive, hors de l'écran.
export const NOTE_ORGANIGRAMME = 'brain/outils/simatis-os-organigramme.md';
export const NOTE_FEUILLE = 'brain/outils/simatis-os-feuille-de-route.md';

// Idées encore à trier qui concernent le développement de l'OS.
export const idéesOS = (noeuds: NoeudCerveau[]) =>
  noeuds.filter(
    (n) => n.categorie === 'idees-en-vrac' && n.concerne === 'os' && n.statut === 'draft',
  );

export const ajouterEtape = (feuille: string, titre: string, cheminIdee: string) =>
  `${feuille.replace(/\n*$/, '\n')}- à faire — [${titre}](../idees-en-vrac/${cheminIdee.split('/').pop()})\n`;

// Seul l'en-tête change : une ligne « statut: draft » dans le corps reste telle quelle.
export const marquerPromue = (idee: string) =>
  idee.replace(/^(---\n[\s\S]*?)^statut:[ \t]*draft[ \t]*$/m, '$1statut: promue');

export type EtatOrg = 'en service' | 'à essayer' | 'partiel';
export type NoeudOrg = {
  nom: string;
  etat: EtatOrg | null;
  description: string;
  enfants: NoeudOrg[];
};
export type RubriqueOrg = { titre: string; noeuds: NoeudOrg[] };

const LIGNE = /^( *)- (.*?)(?: \[(en service|à essayer|partiel)\])?(?: — (.*))?$/;

// La note s'écrit à la main ou par un agent : les deux apostrophes désignent le même nom.
const typo = (texte: string) => texte.replaceAll("'", '’');

// Lit la note de l'organigramme : un `##` par rubrique, puis une liste à puces indentée de deux
// espaces par niveau (`- Nom [état] — description`). Tout le reste (introduction, lignes vides) est ignoré.
export function lireOrganigramme(texte: string): RubriqueOrg[] {
  const rubriques: RubriqueOrg[] = [];
  let pile: NoeudOrg[] = [];
  for (const ligne of texte.split('\n')) {
    const titre = /^## (.+?)\s*$/.exec(ligne);
    if (titre) {
      rubriques.push({ titre: typo(titre[1] as string), noeuds: [] });
      pile = [];
      continue;
    }
    const rubrique = rubriques[rubriques.length - 1];
    const m = rubrique && LIGNE.exec(ligne);
    if (!rubrique || !m) continue;
    const noeud: NoeudOrg = {
      nom: typo((m[2] as string).trim()),
      etat: (m[3] as EtatOrg | undefined) ?? null,
      description: m[4]?.trim() ?? '',
      enfants: [],
    };
    // Un niveau sauté (indentation trop grande) rattache simplement au plus proche parent.
    const profondeur = Math.min(Math.floor((m[1] as string).length / 2), pile.length);
    pile.length = profondeur;
    (profondeur === 0 ? rubrique.noeuds : (pile[profondeur - 1] as NoeudOrg).enfants).push(noeud);
    pile.push(noeud);
  }
  return rubriques;
}

export type DispositionOrg = {
  journee: NoeudOrg[];
  colonnes: { titre: string; noeuds: NoeudOrg[] }[];
  base: NoeudOrg[];
  socle: NoeudOrg[];
  plus: NoeudOrg[];
  // Rubriques ajoutées à la note et pas encore placées dans le schéma : rien ne doit disparaître.
  autres: RubriqueOrg[];
};

const COLONNES = ['Détecter', 'Vendre', 'Piloter l’activité'];
const ZONES = new Set(['Ma journée', 'Ma base', 'Socle et automatismes', 'Plus', ...COLONNES]);

// Range les rubriques de la note dans les zones du schéma, par leur titre.
export function disposerOrganigramme(rubriques: RubriqueOrg[]): DispositionOrg {
  const de = (titre: string) => rubriques.find((r) => r.titre === titre)?.noeuds ?? [];
  return {
    journee: de('Ma journée'),
    colonnes: COLONNES.map((titre) => ({
      titre: titre.replace('Piloter l’activité', 'Piloter'),
      noeuds: de(titre),
    })),
    base: de('Ma base'),
    socle: de('Socle et automatismes'),
    plus: de('Plus'),
    autres: rubriques.filter((r) => !ZONES.has(r.titre)),
  };
}

// Fonctions comptées, sous-fonctions comprises (les rubriques non placées aussi).
export function compterOrganigramme(rubriques: RubriqueOrg[]) {
  let total = 0;
  let enService = 0;
  const parcourir = (n: NoeudOrg) => {
    total++;
    if (n.etat === 'en service') enService++;
    n.enfants.forEach(parcourir);
  };
  rubriques.forEach((r) => r.noeuds.forEach(parcourir));
  return { total, enService };
}
