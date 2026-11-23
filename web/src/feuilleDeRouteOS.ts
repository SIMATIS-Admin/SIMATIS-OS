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

// Lit la note de l'organigramme : un `##` par rubrique, puis une liste à puces indentée de deux
// espaces par niveau (`- Nom [état] — description`). Tout le reste (introduction, lignes vides) est ignoré.
export function lireOrganigramme(texte: string): RubriqueOrg[] {
  const rubriques: RubriqueOrg[] = [];
  let pile: NoeudOrg[] = [];
  for (const ligne of texte.split('\n')) {
    const titre = /^## (.+?)\s*$/.exec(ligne);
    if (titre) {
      rubriques.push({ titre: titre[1] as string, noeuds: [] });
      pile = [];
      continue;
    }
    const rubrique = rubriques[rubriques.length - 1];
    const m = rubrique && LIGNE.exec(ligne);
    if (!rubrique || !m) continue;
    const noeud: NoeudOrg = {
      nom: (m[2] as string).trim(),
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
