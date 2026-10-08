import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { instanceIsolation, metierColumns } from '../db/columns.js';

export const entreprises = pgTable(
  'entreprises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    nom: text('nom').notNull(),
    secteur: text('secteur'),
    ville: text('ville'),
    taille: integer('taille'),
    domaine: text('domaine'),
  },
  (t) => [
    index('entreprises_instance_idx').on(t.instanceId),
    // A copied record is identified by its source: syncs update it instead of duplicating it.
    uniqueIndex('entreprises_source_idx').on(t.instanceId, t.source, t.sourceId),
    instanceIsolation('entreprises'),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    entrepriseId: uuid('entreprise_id').references(() => entreprises.id),
    nom: text('nom').notNull(),
    fonction: text('fonction'),
    email: text('email'),
    telephone: text('telephone'),
    role: text('role'),
  },
  (t) => [
    index('contacts_instance_idx').on(t.instanceId),
    uniqueIndex('contacts_source_idx').on(t.instanceId, t.source, t.sourceId),
    instanceIsolation('contacts'),
  ],
);
