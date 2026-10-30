import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
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
// `site`: a request left on the public website's contact form. `test-vma`: a result of the VMA test.
// `wispr`: a meeting note read in Wispr Flow by the Inbox routine. `partenaire`: news from a partner
// OS through the agents relay.
export const ORIGINES_SUJET = [
  'messagerie',
  'agenda',
  'cerveau',
  'os',
  'site',
  'test-vma',
  'wispr',
  'partenaire',
] as const;
export const STATUTS_SUJET = ['a_traiter', 'tache', 'traite'] as const;
export const PRIORITE_MIN = 1;
export const PRIORITE_MAX = 5;
export const PRIORITE_DEFAUT = 3;

// Source of the entries added by hand in the Inbox screen.
export const SOURCE_MANUELLE = 'manuel';

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
    // 1 (basse) à 5 (haute) ; 3 par défaut, comme une entrée sans besoin particulier.
    priorite: integer('priorite').notNull().default(PRIORITE_DEFAUT),
    contactId: uuid('contact_id').references(() => contacts.id),
    entrepriseId: uuid('entreprise_id').references(() => entreprises.id),
    propositionId: uuid('proposition_id').references(() => propositions.id),
    statut: text('statut', { enum: STATUTS_SUJET }).notNull().default('a_traiter'),
    tacheId: uuid('tache_id').references(() => taches.id),
    traiteAt: timestamp('traite_at', { withTimezone: true }),
    traitePar: text('traite_par'),
    // When the Inbox routine reported the handling back into the second brain.
    reporteAt: timestamp('reporte_at', { withTimezone: true }),
    // Entries added by hand: when the Inbox routine noted their creation in the second brain.
    noteCerveauAt: timestamp('note_cerveau_at', { withTimezone: true }),
  },
  (t) => [
    index('sujets_instance_statut_idx').on(t.instanceId, t.statut),
    uniqueIndex('sujets_source_idx').on(t.instanceId, t.source, t.sourceId),
    instanceIsolation('sujets'),
  ],
);

export type Sujet = typeof sujets.$inferSelect;

// Meeting read in Wispr Flow, one per Wispr id. The full transcript is kept only for a critical
// meeting; unticking « critique » deletes it.
export const reunionsWispr = pgTable(
  'reunions_wispr',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    wisprId: text('wispr_id').notNull(),
    sujetId: uuid('sujet_id')
      .notNull()
      .references(() => sujets.id),
    titre: text('titre').notNull(),
    debutAt: timestamp('debut_at', { withTimezone: true }).notNull(),
    participants: jsonb('participants').$type<string[]>().notNull().default([]),
    resume: text('resume'),
    critique: boolean('critique').notNull().default(false),
    transcript: text('transcript'),
    transcriptAt: timestamp('transcript_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('reunions_wispr_wispr_idx').on(t.instanceId, t.wisprId),
    index('reunions_wispr_sujet_idx').on(t.sujetId),
    instanceIsolation('reunions_wispr'),
  ],
);

export type ReunionWispr = typeof reunionsWispr.$inferSelect;

// Entry prepared by Claude in an add conversation, shown to the pilot before it is added.
export type BrouillonSujet = {
  type: Exclude<TypeSujet, 'a_valider'>;
  titre: string;
  resume: string | null;
  echeance: string | null;
};
export type MessageEchange = { de: 'pilote' | 'claude'; texte: string; at: string };
// `attente_claude`: the runner has to pick it up; `attente_pilote`: Claude answered (or failed).
export const STATUTS_ECHANGE = [
  'attente_claude',
  'en_cours',
  'attente_pilote',
  'ajoute',
  'annule',
] as const;
export type StatutEchange = (typeof STATUTS_ECHANGE)[number];

// Add conversation: the pilot says what to add, Claude (through the runner) turns it into an entry.
export const echangesAjout = pgTable(
  'echanges_ajout',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    statut: text('statut', { enum: STATUTS_ECHANGE }).notNull().default('attente_claude'),
    messages: jsonb('messages').$type<MessageEchange[]>().notNull().default([]),
    brouillon: jsonb('brouillon').$type<BrouillonSujet>(),
    erreur: text('erreur'),
    // Since when Claude is expected to answer: past the delay, the request is given up.
    demandeAt: timestamp('demande_at', { withTimezone: true }).notNull().defaultNow(),
    sujetId: uuid('sujet_id').references(() => sujets.id),
  },
  (t) => [
    index('echanges_ajout_statut_idx').on(t.instanceId, t.statut),
    instanceIsolation('echanges_ajout'),
  ],
);

export type EchangeAjout = typeof echangesAjout.$inferSelect;
