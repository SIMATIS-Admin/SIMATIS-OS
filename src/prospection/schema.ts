import {
  index,
  jsonb,
  integer,
  boolean,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseVivante } from '../base-vivante/schema.js';
import { contacts, taches } from '../crm/schema.js';
import { sujets } from '../inbox/schema.js';
import { instanceIsolation, metierColumns } from '../db/columns.js';

// Prospection : une occurrence est un mail de campagne (relance de tâche ou prospection à froid).
// `brouillon` : créé dans la messagerie mais pas encore envoyé, jamais compté dans les chiffres du jour.
export const MODES_OCCURRENCE = ['relance', 'froid'] as const;
export const ETATS_OCCURRENCE = ['brouillon', 'envoye', 'reponse', 'rdv'] as const;
export type ModeOccurrence = (typeof MODES_OCCURRENCE)[number];
export type EtatOccurrence = (typeof ETATS_OCCURRENCE)[number];

export const OBJECTIF_DEFAUT = 30;
export const OBJECTIF_MAX = 500;

export const prospectionOccurrences = pgTable(
  'prospection_occurrences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    mode: text('mode', { enum: MODES_OCCURRENCE }).notNull(),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    // Prospection à froid : le contact vient de la base vivante, pas du CRM.
    baseId: uuid('base_id').references(() => baseVivante.id, { onDelete: 'set null' }),
    contactNom: text('contact_nom').notNull(),
    societe: text('societe'),
    theme: text('theme').notNull(),
    touche: integer('touche').notNull().default(1),
    etat: text('etat', { enum: ETATS_OCCURRENCE }).notNull(),
    threadId: text('thread_id'),
    envoyeAt: timestamp('envoye_at', { withTimezone: true }),
    lot: text('lot'),
  },
  (t) => [
    index('prospection_occurrences_instance_idx').on(t.instanceId, t.envoyeAt),
    instanceIsolation('prospection_occurrences'),
  ],
);

// Signature d'un mail : une image (PNG ou JPEG) gardée en base64, jamais dans le dépôt.
export const prospectionSignatures = pgTable(
  'prospection_signatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    nom: text('nom').notNull(),
    defaut: boolean('defaut').notNull().default(false),
    typeMime: text('type_mime').notNull(),
    image: text('image').notNull(),
  },
  (t) => [
    uniqueIndex('prospection_signatures_nom_idx').on(t.instanceId, t.nom),
    instanceIsolation('prospection_signatures'),
  ],
);

// Réglages de la prospection, une ligne par instance.
export const prospectionReglages = pgTable(
  'prospection_reglages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    objectifJour: integer('objectif_jour').notNull().default(OBJECTIF_DEFAUT),
  },
  (t) => [
    uniqueIndex('prospection_reglages_instance_idx').on(t.instanceId),
    instanceIsolation('prospection_reglages'),
  ],
);

export type OccurrenceProspection = typeof prospectionOccurrences.$inferSelect;

// `reponse` : le brouillon de réponse à un contact qui a répondu à une campagne (depuis l'Inbox).
export const MODES_CAMPAGNE = ['relance', 'froid', 'reponse'] as const;
export const STATUTS_CAMPAGNE = ['redaction', 'relecture', 'terminee', 'erreur'] as const;
export const ETATS_BROUILLON = ['a_rediger', 'pret', 'a_verifier', 'ecarte', 'cree'] as const;
export const SUIVIS_BROUILLON = ['delai', 'citee', 'clos'] as const;
export const OFFRES = ['vma', 'diagnostic', 'les-deux', 'kairos'] as const;
export type StatutCampagne = (typeof STATUTS_CAMPAGNE)[number];
export type EtatBrouillon = (typeof ETATS_BROUILLON)[number];
export type SuiviBrouillon = (typeof SUIVIS_BROUILLON)[number];

export type ReglageCampagne = {
  offre: (typeof OFFRES)[number];
  creneaux: boolean;
  signatureId: string | null;
  suivi: { type: 'courte' | 'longue' | 'date'; date?: string };
  touchesMax: number;
};
export type ResultatCampagne = {
  brouillons: number;
  simulation: boolean;
  suivisCrees: number;
  suivisNonCrees: number;
  clos: number;
  faites: number;
  // Brouillons que la messagerie a refusés : ils restent prêts, la campagne n'est pas terminée.
  echecs: number;
  // Vrai : les mails sont partis (envoi direct) ; faux : brouillons créés dans la messagerie.
  envoye: boolean;
};

// Lot de mails rédigés par Claude puis relus par Marc. `redaction` : en attente de l'exécuteur ;
// `relecture` : brouillons prêts ; `terminee` : brouillons créés dans la messagerie.
export const prospectionCampagnes = pgTable(
  'prospection_campagnes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    mode: text('mode', { enum: MODES_CAMPAGNE }).notNull(),
    statut: text('statut', { enum: STATUTS_CAMPAGNE }).notNull().default('redaction'),
    reglage: jsonb('reglage').$type<ReglageCampagne>().notNull(),
    erreur: text('erreur'),
    demandeAt: timestamp('demande_at', { withTimezone: true }).notNull().defaultNow(),
    demarreAt: timestamp('demarre_at', { withTimezone: true }),
    termineAt: timestamp('termine_at', { withTimezone: true }),
    resultat: jsonb('resultat').$type<ResultatCampagne>(),
  },
  (t) => [
    index('prospection_campagnes_instance_idx').on(t.instanceId, t.statut),
    instanceIsolation('prospection_campagnes'),
  ],
);

export const prospectionBrouillons = pgTable(
  'prospection_brouillons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    campagneId: uuid('campagne_id')
      .notNull()
      .references(() => prospectionCampagnes.id, { onDelete: 'cascade' }),
    tacheId: uuid('tache_id').references(() => taches.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    baseId: uuid('base_id').references(() => baseVivante.id, { onDelete: 'set null' }),
    // Réponse à un contact : l'entrée de l'Inbox d'où part le brouillon.
    sujetId: uuid('sujet_id').references(() => sujets.id, { onDelete: 'set null' }),
    contactNom: text('contact_nom').notNull(),
    contactEmail: text('contact_email').notNull(),
    societe: text('societe'),
    touche: integer('touche').notNull().default(2),
    etat: text('etat', { enum: ETATS_BROUILLON }).notNull().default('a_rediger'),
    objet: text('objet'),
    // HTML sans signature : la signature (image) est ajoutée à la création du brouillon de messagerie.
    corps: text('corps'),
    note: text('note'),
    threadId: text('thread_id'),
    suiviType: text('suivi_type', { enum: SUIVIS_BROUILLON }).notNull().default('delai'),
    suiviDate: timestamp('suivi_date', { withTimezone: true }),
  },
  (t) => [
    index('prospection_brouillons_campagne_idx').on(t.campagneId),
    instanceIsolation('prospection_brouillons'),
  ],
);

export type Campagne = typeof prospectionCampagnes.$inferSelect;
export type Brouillon = typeof prospectionBrouillons.$inferSelect;

// `repondu` : le contact a répondu, il quitte la séquence.
export const STATUTS_FROID = ['actif', 'epuise', 'repondu'] as const;
export type StatutFroid = (typeof STATUTS_FROID)[number];

// Où en est chaque contact de la base vivante dans la prospection à froid : nombre de touches
// (brouillons créés), plafond choisi à la campagne, dernière touche. « Épuisé » : plus jamais
// proposé, sur confirmation de Marc seulement.
export const prospectionSuiviFroid = pgTable(
  'prospection_suivi_froid',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    baseId: uuid('base_id')
      .notNull()
      .references(() => baseVivante.id, { onDelete: 'cascade' }),
    touches: integer('touches').notNull().default(0),
    touchesMax: integer('touches_max').notNull().default(4),
    derniereLe: timestamp('derniere_le', { withTimezone: true }),
    statut: text('statut', { enum: STATUTS_FROID }).notNull().default('actif'),
  },
  (t) => [
    uniqueIndex('prospection_suivi_froid_base_idx').on(t.instanceId, t.baseId),
    instanceIsolation('prospection_suivi_froid'),
  ],
);
