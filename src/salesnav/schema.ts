import { sql } from 'drizzle-orm';
import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

export type CampagneSalesnav = typeof salesnavCampagnes.$inferSelect;
export type ModeleSalesnav = typeof salesnavModeles.$inferSelect;
