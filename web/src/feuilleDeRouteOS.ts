import type { NoeudCerveau } from './cerveau.js';

// Les deux notes du Drive qui portent la structure de l'OS et ses prochaines étapes.
export const NOTE_STRUCTURE = 'brain/outils/simatis-os-structure.md';
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
  idee.replace(/^(---\n[\s\S]*?)^statut: draft$/m, '$1statut: promue');
