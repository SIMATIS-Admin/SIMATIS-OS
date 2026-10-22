import type { Fiche } from './nettoyage.js';

export const ZONES = ['a_enrichir', 'prospectable'] as const;
export type Zone = (typeof ZONES)[number];

export type Completude = { etat: 'sous_minimum'; raison: string } | { etat: 'pret'; zone: Zone };

// Minimum to leave the airlock: company + name. Prospectable as soon as one contact way is valid.
export function evaluer(f: Fiche): Completude {
  if (!f.entreprise && !f.nom)
    return { etat: 'sous_minimum', raison: 'Entreprise et nom manquants' };
  if (!f.entreprise) return { etat: 'sous_minimum', raison: 'Entreprise manquante' };
  if (!f.nom) return { etat: 'sous_minimum', raison: 'Nom manquant' };
  return { etat: 'pret', zone: f.email || f.telephone ? 'prospectable' : 'a_enrichir' };
}

// A record to enrich never enters a CRM (contacts/entreprises of an instance, hence HubSpot).
export const peutEntrerDansLeCrm = (zone: Zone): boolean => zone === 'prospectable';
