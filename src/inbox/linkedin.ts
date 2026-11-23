import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { NotificationMail } from '../connecteurs/google/google.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { deposerSujet } from './depot.js';
import { sujets } from './schema.js';

// Libellé que le filtre Gmail du pilote pose sur les notifications de messages LinkedIn.
export const LIBELLE_LINKEDIN = 'Messages Linkedin';
// Fenêtre de lecture : un passage manqué (ordinateur éteint) rattrape les jours précédents.
export const JOURS_LINKEDIN = 14;
export const SOURCE_LINKEDIN = 'linkedin';
const TITRE_SANS_NOM = 'Message LinkedIn';
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

// Les mails LinkedIn remplissent l'aperçu de caractères invisibles (U+034F, espaces sans chasse)
// pour pousser le texte de pré-en-tête : on les retire et on resserre les espaces.
export function apercuPropre(extrait: string): string {
  return extrait
    .replace(/[\u034f\u200b-\u200f\u2060\ufeff\u00ad]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Date d'en-tête du mail (« Sat, 21 Nov 2026 20:20:00 +0100 ») ; absente ou illisible : aucune.
export function dateDuMail(date: string | null): Date | null {
  const t = date ? Date.parse(date) : NaN;
  return Number.isNaN(t) ? null : new Date(t);
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
    const recuLe = dateDuMail(n.date);
    const { statut, id } = await deposerSujet(tx, {
      type: 'mail_a_repondre',
      titre: nom ? `${TITRE_SANS_NOM} de ${nom}` : TITRE_SANS_NOM,
      resume: apercuPropre(n.extrait) || null,
      recuLe,
      origine: 'linkedin',
      source: SOURCE_LINKEDIN,
      sourceId: n.messageId,
      lien: MESSAGERIE_LINKEDIN,
    });
    if (statut === 'cree') nouveaux += 1;
    // Entrée déposée avant que l'heure du mail soit conservée : on la complète à ce passage.
    else if (recuLe) {
      await tx
        .update(sujets)
        .set({ recuLe })
        .where(and(eq(sujets.id, id), isNull(sujets.recuLe)));
    }
  }
  return { lues: notifications.length, nouveaux };
}

// Au plus ce nombre de conversations par passage : le Chrome du pilote n'en ouvre pas davantage.
export const LECTURES_MAX = 5;
const TEXTE_MAX = 8000;

// Fenêtre où chercher le message sur LinkedIn : reçu dans l'heure avant le mail (LinkedIn le
// notifie après quelques minutes), par prudence jusqu'à cinq minutes après.
const FENETRE_AVANT_MS = 60 * 60_000;
const FENETRE_APRES_MS = 5 * 60_000;

// LinkedIn affiche les heures de Paris : on les donne toutes faites pour que l'agent n'ait aucune
// conversion à faire (une heure UTC lue comme heure de Paris décale la recherche d'une heure).
const parisJourHeure = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);

export type MessageALire = {
  id: string;
  titre: string;
  apercu: string | null;
  recuLe: string;
  // Heure du mail et fenêtre de recherche, en heure de Paris.
  recuLeParis: string;
  fenetreParis: { de: string; a: string };
};

// Entrées LinkedIn encore à l'aperçu du mail : le texte complet n'a pas été lu sur LinkedIn.
export async function messagesALire(tx: Tx, max = LECTURES_MAX): Promise<MessageALire[]> {
  const rows = await tx
    .select({
      id: sujets.id,
      titre: sujets.titre,
      resume: sujets.resume,
      createdAt: sujets.createdAt,
      recuLe: sujets.recuLe,
    })
    .from(sujets)
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.origine, 'linkedin'),
        eq(sujets.statut, 'a_traiter'),
        isNull(sujets.texteLuAt),
      ),
    )
    .orderBy(asc(sujets.createdAt))
    .limit(max);
  return rows.map((r) => {
    // Sans heure de mail (entrées anciennes), le dépôt est la seule borne connue.
    const recu = r.recuLe ?? r.createdAt;
    return {
      id: r.id,
      titre: r.titre,
      apercu: r.resume,
      recuLe: recu.toISOString(),
      recuLeParis: parisJourHeure(recu),
      fenetreParis: {
        de: parisJourHeure(new Date(recu.getTime() - FENETRE_AVANT_MS)),
        a: parisJourHeure(new Date(recu.getTime() + FENETRE_APRES_MS)),
      },
    };
  });
}

export async function compterMessagesALire(tx: Tx): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(sujets)
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.origine, 'linkedin'),
        eq(sujets.statut, 'a_traiter'),
        isNull(sujets.texteLuAt),
      ),
    );
  return r?.n ?? 0;
}

// Range le texte lu sur LinkedIn dans l'entrée (à la place de l'aperçu du mail). Sans texte, la
// conversation est introuvable : l'aperçu reste et l'entrée n'est plus proposée à la lecture.
export async function enregistrerMessage(
  tx: Tx,
  id: string,
  lu: { texte?: string; expediteur?: string },
): Promise<'enregistre' | 'introuvable'> {
  const [s] = await tx
    .select({ id: sujets.id, titre: sujets.titre })
    .from(sujets)
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.id, id),
        eq(sujets.origine, 'linkedin'),
        eq(sujets.statut, 'a_traiter'),
      ),
    );
  if (!s) return 'introuvable';
  const texte = lu.texte?.trim().slice(0, TEXTE_MAX);
  const expediteur = lu.expediteur?.trim().slice(0, 120);
  await tx
    .update(sujets)
    .set({
      ...(texte ? { resume: texte } : {}),
      // Le nom lu sur LinkedIn complète un titre que l'objet du mail n'avait pas permis de nommer.
      ...(expediteur && s.titre === TITRE_SANS_NOM
        ? { titre: `${TITRE_SANS_NOM} de ${expediteur}` }
        : {}),
      texteLuAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(sujets.instanceId, currentInstance), eq(sujets.id, id)));
  return 'enregistre';
}
