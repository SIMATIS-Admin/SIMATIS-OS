import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { opportunites } from '../crm/schema.js';
import { instanceIsolation, metierColumns } from '../db/columns.js';

// Canal Sales Navigator : les messages envoyés à la main (invitation, remerciement, relances).
// Un modèle par défaut est écrit par cible (`icp`) et par étape ; une campagne peut le remplacer
// pour une étape, sans toucher au modèle par défaut.
export const ETAPES_SALESNAV = ['invitation', 'acceptation', 'relance1', 'relance2'] as const;
export type EtapeSalesnav = (typeof ETAPES_SALESNAV)[number];

export const salesnavCampagnes = pgTable(
  'salesnav_campagnes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    nom: text('nom').notNull(),
    // Cible visée (code libre, le même que celui des modèles par défaut).
    icp: text('icp').notNull(),
  },
  (t) => [
    uniqueIndex('salesnav_campagnes_nom_idx').on(t.instanceId, t.nom),
    instanceIsolation('salesnav_campagnes'),
  ],
);

export const salesnavModeles = pgTable(
  'salesnav_modeles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    icp: text('icp').notNull(),
    etape: text('etape', { enum: ETAPES_SALESNAV }).notNull(),
    // Renseigné : ce texte remplace le modèle par défaut pour cette campagne seulement.
    campagneId: uuid('campagne_id').references(() => salesnavCampagnes.id, {
      onDelete: 'cascade',
    }),
    texte: text('texte').notNull(),
  },
  (t) => [
    uniqueIndex('salesnav_modeles_defaut_idx')
      .on(t.instanceId, t.icp, t.etape)
      .where(sql`campagne_id is null`),
    uniqueIndex('salesnav_modeles_campagne_idx')
      .on(t.campagneId, t.etape)
      .where(sql`campagne_id is not null`),
    instanceIsolation('salesnav_modeles'),
  ],
);

// Réglages du canal : une ligne par instance. Le quota est le nombre de demandes de connexion
// par jour ouvré ; `pause` coupe tout le canal d'un coup.
export const QUOTA_DEFAUT = 8;
export const QUOTA_MAX = 25;

export const salesnavReglages = pgTable(
  'salesnav_reglages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    quotaJour: integer('quota_jour').notNull().default(QUOTA_DEFAUT),
    pause: boolean('pause').notNull().default(false),
  },
  (t) => [
    uniqueIndex('salesnav_reglages_instance_idx').on(t.instanceId),
    instanceIsolation('salesnav_reglages'),
  ],
);

// Journal du canal : une ligne par demande de connexion ou message, envoyé ou reçu. C'est lui qui
// alimente les compteurs de la sous-section SalesNav et la barre de l'état commercial.
export const TYPES_ACTION_SALESNAV = [
  'demande_envoyee',
  'demande_recue',
  'message_envoye',
  'reponse_recue',
] as const;
export type TypeActionSalesnav = (typeof TYPES_ACTION_SALESNAV)[number];

export const salesnavActions = pgTable(
  'salesnav_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    type: text('type', { enum: TYPES_ACTION_SALESNAV }).notNull(),
    opportuniteId: uuid('opportunite_id').references(() => opportunites.id, {
      onDelete: 'set null',
    }),
    campagneId: uuid('campagne_id').references(() => salesnavCampagnes.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('salesnav_actions_instance_idx').on(t.instanceId, t.createdAt),
    instanceIsolation('salesnav_actions'),
  ],
);

export type CampagneSalesnav = typeof salesnavCampagnes.$inferSelect;
export type ModeleSalesnav = typeof salesnavModeles.$inferSelect;
