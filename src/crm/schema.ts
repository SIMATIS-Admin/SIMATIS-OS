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

export type Qualification = {
  besoin: number;
  decideur: number;
  budget: number;
  timing: number;
  engagement: number;
};

export const opportunites = pgTable(
  'opportunites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    entrepriseId: uuid('entreprise_id').references(() => entreprises.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    titre: text('titre').notNull(),
    etape: text('etape').notNull(),
    montant: integer('montant'),
    echeance: date('echeance'),
    clos: text('clos', { enum: ['gagne', 'perdu'] }),
    motif: text('motif'),
    proprietaire: text('proprietaire'),
    // Where the deal came from (fair, network…); `source` is the tool the record was copied from.
    origine: text('origine'),
    qualification: jsonb('qualification').$type<Qualification>(),
    potentiel: text('potentiel'),
    faisabilite: text('faisabilite'),
    prochaineEtape: text('prochaine_etape'),
  },
  (t) => [
    index('opportunites_instance_idx').on(t.instanceId),
    uniqueIndex('opportunites_source_idx').on(t.instanceId, t.source, t.sourceId),
    instanceIsolation('opportunites'),
  ],
);

export const taches = pgTable(
  'taches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    opportuniteId: uuid('opportunite_id').references(() => opportunites.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    titre: text('titre').notNull(),
    canal: text('canal', { enum: ['email', 'appel', 'tache'] }).notNull(),
    echeance: timestamp('echeance', { withTimezone: true }),
    faitAt: timestamp('fait_at', { withTimezone: true }),
    prepare: boolean('prepare').notNull().default(false),
  },
  (t) => [
    index('taches_instance_echeance_idx').on(t.instanceId, t.echeance),
    uniqueIndex('taches_source_idx').on(t.instanceId, t.source, t.sourceId),
    instanceIsolation('taches'),
  ],
);

export const activites = pgTable(
  'activites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    type: text('type').notNull(),
    contactId: uuid('contact_id').references(() => contacts.id),
    at: timestamp('at', { withTimezone: true }).notNull(),
    resume: text('resume'),
  },
  (t) => [
    index('activites_instance_at_idx').on(t.instanceId, t.at),
    uniqueIndex('activites_source_idx').on(t.instanceId, t.source, t.sourceId),
    instanceIsolation('activites'),
  ],
);
