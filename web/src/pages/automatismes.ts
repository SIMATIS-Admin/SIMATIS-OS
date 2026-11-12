import type { Execution } from '../api.js';

// Les routines de Claude, présentées par ce qu'elles font pour le pilote plutôt que par leur nom
// technique. Une routine inconnue garde son nom d'origine, dans « Autres ».
export type GroupeAutomatisme = 'quotidien' | 'occasionnel';
export type FicheAutomatisme = { nom: string; utilite: string; groupe: GroupeAutomatisme };

export const AUTOMATISMES: Record<string, FicheAutomatisme> = {
  inbox: {
    nom: 'Votre Inbox du matin',
    utilite:
      'Claude lit votre messagerie, votre agenda et votre second cerveau, puis dépose dans l’Inbox ce qui demande votre attention.',
    groupe: 'quotidien',
  },
  quotidienne: {
    nom: 'Les relances du jour',
    utilite:
      'Claude prépare les relances dues : brouillons de mails avec des créneaux libres, et le planning d’appels. Rien n’est envoyé sans vous.',
    groupe: 'quotidien',
  },
  nettoyage: {
    nom: 'Le ménage des tâches',
    utilite:
      'Une fois vos relances parties, Claude clôture les tâches correspondantes et propose la suite à donner.',
    groupe: 'occasionnel',
  },
  hebdo: {
    nom: 'La revue de la semaine',
    utilite:
      'Chaque semaine, Claude relit le pipeline, liste les devis à relancer et propose des notes pour le second cerveau.',
    groupe: 'occasionnel',
  },
  evenement: {
    nom: 'Les réactions aux événements',
    utilite:
      'Claude réagit à un nouveau lead, à une réponse reçue ou à un devis resté sans réponse.',
    groupe: 'occasionnel',
  },
  base: {
    nom: 'L’entretien de la base',
    utilite:
      'Claude prépare les imports, corrige les lignes signalées et classe les réponses reçues. Rien n’entre dans la base sans votre validation.',
    groupe: 'occasionnel',
  },
};

export const TITRES_GROUPES: Record<GroupeAutomatisme, string> = {
  quotidien: 'Au quotidien',
  occasionnel: 'Occasionnels',
};

const jour = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

const court = (texte: string, max = 140) =>
  texte.length > max ? `${texte.slice(0, max - 1).trimEnd()}…` : texte;

// Le dernier résultat en une phrase : ce qui a été fait, ou qu'un problème a eu lieu. Le détail
// (étapes, erreurs des outils) reste derrière « Voir le détail ».
export function phraseDuResultat(e: Execution | null): string {
  if (!e) return 'Pas encore lancé.';
  if (e.statut === 'demandee') return 'En attente de l’exécuteur de votre ordinateur.';
  if (e.statut === 'en_cours') return 'Claude travaille en ce moment.';
  const quand = jour(e.fin ?? e.createdAt);
  if (e.statut === 'echouee') return `Le ${quand} : un problème est survenu. Voir le détail.`;
  const r = e.rapport;
  if (!r) return `Le ${quand} : terminé.`;
  const fait = r.fait[0] ? court(r.fait[0]) : 'rien à signaler';
  const reste =
    r.fait.length > 1 ? ` (et ${r.fait.length - 1} autre${r.fait.length > 2 ? 's' : ''})` : '';
  const attente = r.attente.length > 0 ? ` ${r.attente.length} à valider de votre côté.` : '';
  const probleme = r.echec.length > 0 ? ' Un point a posé problème : voir le détail.' : '';
  return `Le ${quand} : ${fait}${reste}.${attente}${probleme}`;
}
