import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { instanceIsolation, metierColumns } from '../db/columns.js';

// Gestion (instance « Mon activité » uniquement). Montants en centimes entiers, dates = jours de Paris.
// Une dépense est une série : ponctuelle (récurrence « aucune ») ou récurrente. Ses occurrences se
// calculent à la demande ; seules les réalisations et exceptions sont stockées (gestion_depense_exceptions).
export const STATUTS_DEPENSE = ['reelle', 'prevue'] as const;
export const RECURRENCES = ['aucune', 'mensuelle', 'trimestrielle', 'annuelle'] as const;
export const PAYEURS = ['societe', 'associe'] as const;
export const ETATS_OCCURRENCE_DEPENSE = ['payee', 'ignoree'] as const;
export type StatutDepense = (typeof STATUTS_DEPENSE)[number];
export type Recurrence = (typeof RECURRENCES)[number];

// Rattachement analytique : SIMATIS, KAIROS ou un mandat. Ce n'est pas une refacturation.
export type Affectation = { cible: 'simatis' | 'kairos' | 'mandat'; mandatId?: string };

export const gestionDepenses = pgTable(
  'gestion_depenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    libelle: text('libelle').notNull(),
    categorie: text('categorie'),
    montantTtcCents: integer('montant_ttc_cents').notNull(),
    // Avancé, facultatif : sans valeur, la TVA n'est pas estimée.
    tvaCents: integer('tva_cents'),
    statut: text('statut', { enum: STATUTS_DEPENSE }).notNull(),
    recurrence: text('recurrence', { enum: RECURRENCES }).notNull().default('aucune'),
    // Première échéance (ou date unique) et dernière échéance éventuelle (incluse).
    dateDebut: date('date_debut', { mode: 'string' }).notNull(),
    dateFin: date('date_fin', { mode: 'string' }),
    payeur: text('payeur', { enum: PAYEURS }).notNull().default('societe'),
    affectations: jsonb('affectations').$type<Affectation[]>().notNull().default([]),
    // « Refacturable » est une intention ; la refacturation réelle est un revenu à part (Lot B).
    refacturable: boolean('refacturable').notNull().default(false),
    // Référence texte ou lien ; les pièces jointes viendront plus tard.
    justificatif: text('justificatif'),
    // Suppression douce : une dépense archivée disparaît des vues mais reste en base.
    archiveeAt: timestamp('archivee_at', { withTimezone: true }),
  },
  (t) => [
    index('gestion_depenses_instance_idx').on(t.instanceId, t.dateDebut),
    instanceIsolation('gestion_depenses'),
  ],
);

// Réalisation ou exception d'une occurrence : identifiée par (série, date d'origine) pour ne jamais
// doubler une occurrence quand la série est relue.
export const gestionDepenseExceptions = pgTable(
  'gestion_depense_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    depenseId: uuid('depense_id')
      .notNull()
      .references(() => gestionDepenses.id, { onDelete: 'cascade' }),
    dateOrigine: date('date_origine', { mode: 'string' }).notNull(),
    etat: text('etat', { enum: ETATS_OCCURRENCE_DEPENSE }).notNull(),
    // Écarts éventuels par rapport à la série (date réelle de paiement, montant réellement débité).
    datePaiement: date('date_paiement', { mode: 'string' }),
    montantTtcCents: integer('montant_ttc_cents'),
  },
  (t) => [
    uniqueIndex('gestion_depense_exceptions_occ_idx').on(t.depenseId, t.dateOrigine),
    instanceIsolation('gestion_depense_exceptions'),
  ],
);
