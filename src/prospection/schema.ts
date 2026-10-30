import {
  index,
  integer,
  boolean,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { contacts } from '../crm/schema.js';
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
