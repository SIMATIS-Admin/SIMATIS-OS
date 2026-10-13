import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { contacts, entreprises, taches } from '../crm/schema.js';
import { instanceIsolation, metierColumns } from '../db/columns.js';
import { propositions } from '../propositions/schema.js';

export const TYPES_SUJET = [
  'mail_a_repondre',
  'devis',
  'diagnostic',
  'compte_rendu',
  'brouillon_non_envoye',
  'a_valider',
  'autre',
] as const;
// `site`: a request left on the public website's contact form.
export const ORIGINES_SUJET = ['messagerie', 'agenda', 'cerveau', 'os', 'site'] as const;
export const STATUTS_SUJET = ['a_traiter', 'tache', 'traite'] as const;

export type TypeSujet = (typeof TYPES_SUJET)[number];
export type OrigineSujet = (typeof ORIGINES_SUJET)[number];
export type StatutSujet = (typeof STATUTS_SUJET)[number];

// Inbox subject: something important to handle, dropped by a routine or by a proposal.
// `sourceId` carries the stable key given by the depositor: one subject per key, forever.
export const sujets = pgTable(
  'sujets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    type: text('type', { enum: TYPES_SUJET }).notNull(),
    titre: text('titre').notNull(),
    resume: text('resume'),
    origine: text('origine', { enum: ORIGINES_SUJET }).notNull(),
    lien: text('lien'),
    echeance: timestamp('echeance', { withTimezone: true }),
    contactId: uuid('contact_id').references(() => contacts.id),
    entrepriseId: uuid('entreprise_id').references(() => entreprises.id),
    propositionId: uuid('proposition_id').references(() => propositions.id),
    statut: text('statut', { enum: STATUTS_SUJET }).notNull().default('a_traiter'),
    tacheId: uuid('tache_id').references(() => taches.id),
    traiteAt: timestamp('traite_at', { withTimezone: true }),
    traitePar: text('traite_par'),
    // When the Inbox routine reported the handling back into the second brain.
    reporteAt: timestamp('reporte_at', { withTimezone: true }),
  },
  (t) => [
    index('sujets_instance_statut_idx').on(t.instanceId, t.statut),
    uniqueIndex('sujets_source_idx').on(t.instanceId, t.source, t.sourceId),
    instanceIsolation('sujets'),
  ],
);

export type Sujet = typeof sujets.$inferSelect;
