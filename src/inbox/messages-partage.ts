import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Carte, Noeud } from '../cerveau/carte.js';
import type { Instance } from '../instances/schema.js';
import { deposerSujet } from './depot.js';

// Un message que l'autre (Christophe) dépose dans echanges/ doit apparaître dans l'Inbox sans
// attendre la routine du matin. Le runner redépose la carte de l'espace partagé toutes les dix
// minutes : chaque nouveau message de l'autre y devient un sujet, avec la clé `partage:<chemin>` de
// la routine « alimenter-inbox ». Une clé déjà prise ne recrée rien, quel que soit le canal arrivé
// le premier (kDrive, relais ou routine), et un sujet coché ne revient jamais.

// Au-delà, un message est de l'histoire ancienne : la routine ne l'a pas retenu, l'Inbox non plus.
export const FENETRE_MS = 7 * 86_400_000;

const nomPropre = (auteur: string) => auteur.charAt(0).toUpperCase() + auteur.slice(1);

export function titreMessage(n: Pick<Noeud, 'titre' | 'genre' | 'auteur'>): string {
  const de = nomPropre(n.auteur ?? 'l’autre');
  if (n.genre === 'question') return `Répondre à ${de} : ${n.titre}`;
  if (n.genre === 'reponse') return `${de} répond : ${n.titre}`;
  return `Lire le message de ${de} : ${n.titre}`;
}

export async function deposerMessagesPartage(
  db: Executor,
  instance: Instance,
  carte: Pick<Carte, 'noeuds' | 'moi'>,
  maintenant = new Date(),
): Promise<number> {
  const moi = (carte.moi ?? '').toLowerCase();
  // Sans savoir qui consulte, on ne sait pas distinguer ses propres messages : on ne dépose rien.
  if (!moi) return 0;
  const recents = carte.noeuds.filter((n) => {
    if (n.categorie !== 'echanges' || !n.auteur || n.auteur.toLowerCase() === moi) return false;
    const date = n.date ? Date.parse(n.date) : NaN;
    return Number.isFinite(date) && maintenant.getTime() - date <= FENETRE_MS;
  });
  if (!recents.length) return 0;
  return withInstance(db, instance.id, async (tx) => {
    let nouveaux = 0;
    for (const n of recents) {
      const { statut } = await deposerSujet(tx, {
        type: n.genre === 'question' ? 'mail_a_repondre' : 'autre',
        titre: titreMessage(n),
        resume: `Message : ${n.id}.`,
        origine: 'messagerie',
        source: 'routine',
        sourceId: `partage:${n.id}`,
      });
      if (statut === 'cree') nouveaux++;
    }
    return nouveaux;
  });
}
