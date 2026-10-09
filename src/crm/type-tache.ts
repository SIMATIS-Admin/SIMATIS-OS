// Task type (Email / Téléphone / Action) read from the title: HubSpot tasks created from the
// mailbox or by hand are mostly typed "TODO", while their title says what to do.
export type Canal = 'email' | 'appel' | 'tache';

const APPEL = new Set(['appeler', 'rappeler', 'appel', 'tel', 'telephone', 'telephoner', 'call']);
// "e-mail" splits into "e" and "mail": "mail" is enough.
const EMAIL = new Set(['mail', 'email', 'courriel', 'envoyer', 'envoi']);
const HUBSPOT: Record<string, Canal> = { EMAIL: 'email', CALL: 'appel' };

const mots = (titre: string) =>
  titre
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/);

// The title wins when it names a channel (phone first: "Appeler pour envoyer le devis" is a call).
export function typeTache(titre: string, typeHubspot?: string | null): Canal {
  const m = mots(titre);
  if (m.some((w) => APPEL.has(w))) return 'appel';
  if (m.some((w) => EMAIL.has(w))) return 'email';
  return HUBSPOT[typeHubspot ?? ''] ?? 'tache';
}
