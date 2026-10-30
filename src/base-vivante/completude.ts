import type { Fiche } from './nettoyage.js';

export const ZONES = ['a_enrichir', 'prospectable'] as const;
export type Zone = (typeof ZONES)[number];

export type Completude = { etat: 'sous_minimum'; raison: string } | { etat: 'pret'; zone: Zone };

// Minimum to leave the airlock: a company. A record is prospectable once it also has a name and
// one valid contact way; a company alone (or without a name) waits in « à enrichir » for a contact.
export function evaluer(f: Fiche): Completude {
  if (!f.entreprise) return { etat: 'sous_minimum', raison: 'Entreprise manquante' };
  return { etat: 'pret', zone: f.nom && (f.email || f.telephone) ? 'prospectable' : 'a_enrichir' };
}

// A record to enrich never enters a CRM (contacts/entreprises of an instance, hence HubSpot).
export const peutEntrerDansLeCrm = (zone: Zone): boolean => zone === 'prospectable';
