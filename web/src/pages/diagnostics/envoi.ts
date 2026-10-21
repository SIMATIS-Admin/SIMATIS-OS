import type { EnvoiInvitation } from '../../api.js';

// Ce que l'écran dit du mail d'invitation. Sans envoi (pas d'adresse), rien à dire.
export function messageEnvoi(envoi: EnvoiInvitation | null, email: string | null): string | null {
  if (!envoi) return null;
  if (envoi.statut === 'envoye') return `Mail envoyé à ${email ?? 'le dirigeant'}.`;
  if (envoi.statut === 'simule')
    return 'Mail non envoyé : les écritures réelles sont désactivées (simulation). Copiez le lien et envoyez-le vous-même.';
  return `Mail non envoyé${envoi.raison ? ` : ${envoi.raison}` : ''}. Copiez le lien et envoyez-le vous-même.`;
}
