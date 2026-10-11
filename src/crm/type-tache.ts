// Activity type read from the title: HubSpot tasks created from the mailbox or by hand are mostly
// typed "TODO", while their title says what to do.
export type Canal = 'email' | 'appel' | 'tache';
export type TypeActivite = 'appel' | 'email' | 'tache' | 'reunion' | 'echeance' | 'dejeuner';
export const TYPES_ACTIVITE: TypeActivite[] = [
  'appel',
  'email',
  'tache',
  'reunion',
  'echeance',
  'dejeuner',
];

// Checked in this order: phone first ("Appeler pour envoyer le devis" is a call), then email.
// "e-mail" splits into "e" and "mail": "mail" is enough.
const MOTS: [TypeActivite, Set<string>][] = [
  ['appel', new Set(['appeler', 'rappeler', 'appel', 'tel', 'telephone', 'telephoner', 'call'])],
  ['email', new Set(['mail', 'email', 'courriel', 'envoyer', 'envoi'])],
  ['reunion', new Set(['reunion', 'rdv', 'rendez', 'visio', 'meeting'])],
  ['dejeuner', new Set(['dejeuner', 'dej', 'diner', 'cafe'])],
  ['echeance', new Set(['echeance', 'limite', 'deadline'])],
];
const HUBSPOT: Record<string, TypeActivite> = { EMAIL: 'email', CALL: 'appel' };

const mots = (titre: string) =>
  titre
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/);

export function typeActivite(titre: string, typeHubspot?: string | null): TypeActivite {
  const m = mots(titre);
  for (const [type, famille] of MOTS) if (m.some((w) => famille.has(w))) return type;
  return HUBSPOT[typeHubspot ?? ''] ?? 'tache';
}

export const canalDe = (type: TypeActivite): Canal =>
  type === 'appel' || type === 'email' ? type : 'tache';

export const typeTache = (titre: string, typeHubspot?: string | null): Canal =>
  canalDe(typeActivite(titre, typeHubspot));
