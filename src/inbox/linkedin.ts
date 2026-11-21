import type { NotificationMail } from '../connecteurs/google/google.js';
import type { Tx } from '../db.js';
import { deposerSujet } from './depot.js';

// Libellé que le filtre Gmail du pilote pose sur les notifications de messages LinkedIn.
export const LIBELLE_LINKEDIN = 'Messages Linkedin';
// Fenêtre de lecture : un passage manqué (ordinateur éteint) rattrape les jours précédents.
export const JOURS_LINKEDIN = 14;
export const SOURCE_LINKEDIN = 'linkedin';
const MESSAGERIE_LINKEDIN = 'https://www.linkedin.com/messaging/';

// Les objets des notifications LinkedIn varient d'une langue et d'une version à l'autre : on essaie
// les formes connues, et sans nom l'entrée reste utile avec son aperçu.
const FORMES = [
  /(?:message de|message from)\s+(.+?)\s*$/i,
  /^(.+?)\s+(?:vous a envoyé|sent you)(?=\s)/i,
];

export function expediteurLinkedin(objet: string | null): string | null {
  if (!objet) return null;
  for (const forme of FORMES) {
    const nom = forme.exec(objet.trim())?.[1]?.trim();
    if (nom) return nom;
  }
  return null;
}

// Dépose une entrée Inbox par notification non encore vue (la clé est l'identifiant du mail : une
// entrée cochée ne revient jamais). `lire` donne les notifications du libellé.
export async function actualiserLinkedin(
  tx: Tx,
  lire: () => Promise<NotificationMail[]>,
): Promise<{ lues: number; nouveaux: number }> {
  const notifications = await lire();
  let nouveaux = 0;
  for (const n of notifications) {
    const nom = expediteurLinkedin(n.objet);
    const { statut } = await deposerSujet(tx, {
      type: 'mail_a_repondre',
      titre: nom ? `Message LinkedIn de ${nom}` : 'Message LinkedIn',
      resume: n.extrait || null,
      origine: 'linkedin',
      source: SOURCE_LINKEDIN,
      sourceId: n.messageId,
      lien: MESSAGERIE_LINKEDIN,
    });
    if (statut === 'cree') nouveaux += 1;
  }
  return { lues: notifications.length, nouveaux };
}
