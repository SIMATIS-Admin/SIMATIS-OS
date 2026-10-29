export type AccesCerveau = 'ajout' | 'lecture';

const REGLE: Record<AccesCerveau, string> = {
  ajout:
    "Ajoute seulement : ne supprime ni ne réécris jamais une note existante, et n'écris nulle part ailleurs.",
  lecture: "Lecture seule : n'y écris rien.",
};

// Sans cette orientation, Claude cherchait seulement dans le dossier de travail du run ou au hasard
// (un logo ou un mail introuvable alors que le second cerveau le contenait).
const orientation = (cerveau: string) =>
  [
    'Pour retrouver une information (entreprise, contact, logo, mail, décision, méthode), commence par lire CLAUDE.md, REGLES-IA.md et index.md à la racine du second cerveau, puis suis les index de brain/ (clients, mandats, méthodes, outils).',
    `Cherche ensuite avec Grep et Glob en passant le path « ${cerveau} » (le dossier de travail n'est pas le second cerveau), sur le nom exact et ses variantes, y compris dans sources/ et dans les fichiers non Markdown.`,
    "Ne conclus qu'une information n'existe pas qu'après cette recherche, et dis alors précisément ce que tu as cherché.",
  ].join(' ');

// Consigne commune à tous les runs qui ont accès au second cerveau du poste.
export const consigneCerveau = (cerveau: string, acces: AccesCerveau) =>
  `Second cerveau : ${cerveau}. ${REGLE[acces]} ${orientation(cerveau)}`;
