import type { LimitesIA } from '../ia/limites.js';
import { ErreurIA } from './client.js';

// Sous ce quota restant (en %) sur la fenêtre de 5 heures, la recherche Codex n'est pas lancée : elle
// échouerait en route et laisserait la journée marquée comme faite.
export const SEUIL_QUOTA = 5;
// Une mesure plus vieille que ça ne dit plus rien du quota d'aujourd'hui.
const FRAICHEUR_MS = 2 * 3_600_000;

export type QuotaCodex = { restant: number; reinitialiseLe: Date };

// Le quota ChatGPT (Codex) restant sur la fenêtre de 5 heures, d'après la mesure du compteur de la
// console. Rien quand la mesure est ancienne, absente, en erreur ou que la fenêtre est déjà renouvelée.
export function quotaCodex(limites: LimitesIA | null, maintenant: Date): QuotaCodex | null {
  const chatgpt = limites?.fournisseurs.find((f) => f.id === 'chatgpt');
  if (!limites?.actualiseLe || !chatgpt || chatgpt.etat !== 'ok' || !chatgpt.fenetre5h) return null;
  if (maintenant.getTime() - Date.parse(limites.actualiseLe) > FRAICHEUR_MS) return null;
  const reinitialiseLe = new Date(chatgpt.fenetre5h.reinitialiseLe);
  if (reinitialiseLe <= maintenant) return null;
  return { restant: chatgpt.fenetre5h.restant, reinitialiseLe };
}

export const quotaBas = (q: QuotaCodex | null): q is QuotaCodex =>
  q !== null && q.restant <= SEUIL_QUOTA;

const heureParis = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);

// Heure du nouvel essai : une minute après le renouvellement de la fenêtre.
export const apresRenouvellement = (q: QuotaCodex) => new Date(q.reinitialiseLe.getTime() + 60_000);

export const attenteQuota = (q: QuotaCodex) =>
  `Quota ChatGPT presque épuisé (${q.restant} % restant). Nouvel essai à ${heureParis(apresRenouvellement(q))}.`;

// Ce que l'on peut honnêtement dire d'un échec : le quota s'il est bas, sinon ce que Codex a fait
// savoir (rien de sa sortie, qui peut contenir des données de fiche).
export function expliquerEchec(
  erreur: unknown,
  quota: QuotaCodex | null,
): { bilan: string; erreur: string; quotaBas: boolean } {
  if (quotaBas(quota))
    return { bilan: attenteQuota(quota), erreur: 'Quota ChatGPT presque épuisé.', quotaBas: true };
  const message = erreur instanceof ErreurIA ? erreur.message : '';
  if (message.includes('n’a pas répondu'))
    return {
      bilan: 'Le programme Codex du Mac n’a pas répondu en 10 minutes : vérifiez qu’il tourne.',
      erreur: 'Le programme Codex du Mac n’a pas répondu.',
      quotaBas: false,
    };
  if (message.includes('a échoué sur le Mac'))
    return {
      bilan:
        'Codex a échoué sur le Mac, sans en donner la cause. Un quota ChatGPT épuisé est la première chose à vérifier.',
      erreur: 'La recherche Codex a échoué sur le Mac.',
      quotaBas: false,
    };
  return {
    bilan: 'Recherche interrompue par une erreur interne.',
    erreur: 'Erreur interne pendant la recherche.',
    quotaBas: false,
  };
}
