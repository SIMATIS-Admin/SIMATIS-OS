import type { Qualification } from '../../crm/schema.js';
import type { FicheCrmOs } from './client.js';

// A record of the compatible CRM (profile crm/1, fields in snake_case) as the columns of the OS tables.
// Values are checked one by one: a wrong type gives null, never a failing sync.
const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const entier = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
const booleen = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const horodatage = (v: unknown): Date | null => {
  const d = typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const parmi = <T extends string>(v: unknown, valeurs: readonly T[]): T | null =>
  typeof v === 'string' && (valeurs as readonly string[]).includes(v) ? (v as T) : null;

export const premier = (l: string | string[] | null | undefined): string | null =>
  Array.isArray(l) ? (l[0] ?? null) : (l ?? null);
export const liste = (l: string | string[] | null | undefined): string[] =>
  Array.isArray(l) ? l : l ? [l] : [];

export function mapEntreprise(f: FicheCrmOs) {
  const c = f.champs;
  const nom = texte(c.nom);
  if (!nom) return null;
  return {
    nom,
    secteur: texte(c.secteur),
    ville: texte(c.ville),
    taille: entier(c.taille),
    domaine: texte(c.domaine),
  };
}

export function mapContact(f: FicheCrmOs) {
  const c = f.champs;
  const nom = texte(c.nom);
  if (!nom) return null;
  return {
    values: {
      nom,
      fonction: texte(c.fonction),
      email: texte(c.email),
      telephone: texte(c.telephone),
      role: texte(c.role),
    },
    // Every address, the primary one first; the others live in contact_emails.
    emails: Array.isArray(c.emails)
      ? c.emails.filter((e): e is string => typeof e === 'string')
      : [],
  };
}

const QUALIFICATION = ['besoin', 'decideur', 'budget', 'timing', 'engagement'] as const;
function qualification(v: unknown): Qualification | null {
  if (!v || typeof v !== 'object') return null;
  const q = v as Record<string, unknown>;
  return QUALIFICATION.every((k) => Number.isInteger(q[k]))
    ? (q as unknown as Qualification)
    : null;
}

export function mapAffaire(f: FicheCrmOs) {
  const c = f.champs;
  const titre = texte(c.titre);
  const etape = texte(c.etape);
  if (!titre || !etape) return null;
  return {
    // Mirrored on every pass, like the fields HubSpot gives.
    miroir: {
      titre,
      etape,
      montant: entier(c.montant),
      echeance: texte(c.echeance),
      clos: parmi(c.clos, ['gagne', 'perdu'] as const),
      motif: texte(c.motif),
      proprietaire: texte(c.proprietaire),
      derniereActivite: horodatage(c.derniere_activite),
      etapesDates:
        c.etapes_dates && typeof c.etapes_dates === 'object'
          ? (c.etapes_dates as Record<string, string>)
          : {},
    },
    // Fields that belong to the OS (billing terms, hand-set probability, qualification…): copied
    // when the deal is first seen, then left to the OS, as for a HubSpot deal.
    creation: {
      origine: texte(c.origine),
      prochaineEtape: texte(c.prochaine_etape),
      modeFacturation: parmi(c.mode_facturation, ['spot', 'recurrent'] as const) ?? 'spot',
      dureeEngagementMois: entier(c.duree_engagement_mois) ?? 12,
      taciteReconduction: booleen(c.tacite_reconduction) ?? true,
      probabiliteManuelle: entier(c.probabilite_manuelle),
      qualification: qualification(c.qualification),
      potentiel: texte(c.potentiel),
      faisabilite: texte(c.faisabilite),
    },
  };
}

const TYPES_TACHE = ['appel', 'email', 'tache', 'reunion', 'echeance', 'dejeuner'] as const;
export function mapTache(f: FicheCrmOs) {
  const c = f.champs;
  const titre = texte(c.titre);
  if (!titre) return null;
  const type = parmi(c.type, TYPES_TACHE) ?? 'tache';
  return {
    titre,
    type,
    canal: type === 'appel' || type === 'email' ? type : ('tache' as const),
    echeance: horodatage(c.echeance),
    avecHeure: booleen(c.avec_heure) ?? false,
    dureeMinutes: entier(c.duree_minutes),
    occupe: booleen(c.occupe) ?? false,
    faitAt: horodatage(c.fait_at),
    notes: texte(c.notes),
  };
}

export function mapActivite(f: FicheCrmOs) {
  const c = f.champs;
  const type = parmi(c.type, ['note', 'appel', 'email', 'reunion'] as const);
  const at = horodatage(c.at);
  if (!type || !at) return null;
  return { type, at, titre: texte(c.titre), resume: texte(c.resume) };
}
