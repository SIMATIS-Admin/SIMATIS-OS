import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { instanceIsolation, metierColumns } from '../db/columns.js';
import { propositions } from '../propositions/schema.js';

// What a partner may see of the sales follow-up (« Alpes OS voit »): the kit's data objects.
export const OBJETS_PARTAGE = ['prospect', 'rendez_vous', 'affaire', 'compte_rendu'] as const;
export type ObjetPartage = (typeof OBJETS_PARTAGE)[number];

export const ETATS_MISSION = [
  'simulation',
  'submitted',
  'working',
  'input-required',
  'completed',
  'failed',
  'canceled',
  'rejected',
] as const;
export type EtatMissionLocal = (typeof ETATS_MISSION)[number];

export type EntreeHistorique = {
  etat: EtatMissionLocal | null;
  at: string;
  message: string | null;
  enveloppe: string | null;
};

// One row per connection of the agents relay: another OS this instance works with.
export const partenaires = pgTable(
  'partenaires',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    connexionId: text('connexion_id').notNull(),
    noeudId: text('noeud_id').notNull(),
    nom: text('nom').notNull(),
    carte: jsonb('carte').$type<Record<string, unknown>>(),
    // Missions received from this partner (brique 2): stored now, used later.
    niveau: text('niveau', { enum: ['L0', 'L1', 'L2', 'L3'] })
      .notNull()
      .default('L0'),
    partage: jsonb('partage').$type<ObjetPartage[]>().notNull().default([]),
    statut: text('statut', { enum: ['active', 'coupee'] })
      .notNull()
      .default('active'),
    coupeeAt: timestamp('coupee_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('partenaires_connexion_idx').on(t.instanceId, t.connexionId),
    instanceIsolation('partenaires'),
  ],
);

export type Partenaire = typeof partenaires.$inferSelect;

// Missions entrusted to a partner (and, in brique 2, received). `id` is the A2A task id, shared
// with the partner.
export const missions = pgTable(
  'missions',
  {
    id: text('id').primaryKey(),
    ...metierColumns(),
    partenaireId: uuid('partenaire_id')
      .notNull()
      .references(() => partenaires.id),
    sens: text('sens', { enum: ['envoyee', 'recue'] }).notNull(),
    titre: text('titre').notNull(),
    consigne: text('consigne').notNull(),
    contexte: jsonb('contexte').$type<Record<string, unknown>>(),
    etat: text('etat', { enum: ETATS_MISSION }).notNull(),
    dernierMessage: text('dernier_message'),
    resultat: jsonb('resultat').$type<Record<string, unknown>>(),
    historique: jsonb('historique').$type<EntreeHistorique[]>().notNull().default([]),
    propositionId: uuid('proposition_id').references(() => propositions.id),
    confieePar: text('confiee_par'),
  },
  (t) => [
    index('missions_partenaire_idx').on(t.instanceId, t.partenaireId),
    instanceIsolation('missions'),
  ],
);

export type MissionPartenaire = typeof missions.$inferSelect;

// Trace of the facts pushed to a partner. `id` is the relay envelope id.
export const donneesEnvoyees = pgTable(
  'donnees_envoyees',
  {
    id: text('id').primaryKey(),
    ...metierColumns(),
    partenaireId: uuid('partenaire_id')
      .notNull()
      .references(() => partenaires.id),
    objet: text('objet', { enum: OBJETS_PARTAGE }).notNull(),
    evenement: text('evenement').notNull(),
    ref: text('ref').notNull(),
    champs: jsonb('champs').$type<Record<string, unknown>>().notNull().default({}),
    propositionId: uuid('proposition_id').references(() => propositions.id),
    envoyeePar: text('envoyee_par'),
  },
  () => [instanceIsolation('donnees_envoyees')],
);

// The kit's outbox: envelopes waiting to be posted to the relay, retried until accepted.
export const relaisSorties = pgTable(
  'relais_sorties',
  {
    id: text('id').primaryKey(),
    ...metierColumns(),
    connexionId: text('connexion_id').notNull(),
    type: text('type').notNull(),
    corps: jsonb('corps').$type<Record<string, unknown>>().notNull(),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull(),
    prochainEssai: timestamp('prochain_essai', { withTimezone: true }),
  },
  () => [instanceIsolation('relais_sorties')],
);

// Envelopes already handled: the relay may deliver one twice, it is processed once.
export const relaisVus = pgTable(
  'relais_vus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    enveloppeId: text('enveloppe_id').notNull(),
    vuAt: timestamp('vu_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('relais_vus_enveloppe_idx').on(t.instanceId, t.enveloppeId),
    instanceIsolation('relais_vus'),
  ],
);
