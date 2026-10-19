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
    // HubSpot « last activity date », then each activity marked done in the OS.
    derniereActivite: timestamp('derniere_activite', { withTimezone: true }),
    // Date each stage was entered (HubSpot hs_date_entered_<stage>, or moves made in the OS).
    etapesDates: jsonb('etapes_dates').$type<Record<string, string>>().notNull().default({}),
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
    entrepriseId: uuid('entreprise_id').references(() => entreprises.id),
    // Person or company chosen in the OS: the HubSpot sync no longer overwrites the links.
    lienChoisi: boolean('lien_choisi').notNull().default(false),
    titre: text('titre').notNull(),
    canal: text('canal', { enum: ['email', 'appel', 'tache'] }).notNull(),
    echeance: timestamp('echeance', { withTimezone: true }),
    faitAt: timestamp('fait_at', { withTimezone: true }),
    prepare: boolean('prepare').notNull().default(false),
    notes: text('notes'),
    // Pipedrive-like activity: exact type (canal is derived from it), optional time of day,
    // duration and busy flag. HubSpot knows none of these but the CALL / EMAIL / TODO type.
    type: text('type', {
      enum: ['appel', 'email', 'tache', 'reunion', 'echeance', 'dejeuner'],
    })
      .notNull()
      .default('tache'),
    // Chosen in the OS: the HubSpot sync no longer overwrites it.
    typeChoisi: boolean('type_choisi').notNull().default(false),
    avecHeure: boolean('avec_heure').notNull().default(false),
    dureeMinutes: integer('duree_minutes'),
    occupe: boolean('occupe').notNull().default(false),
  },
  (t) => [
    index('taches_instance_echeance_idx').on(t.instanceId, t.echeance),
    uniqueIndex('taches_source_idx').on(t.instanceId, t.source, t.sourceId),
    instanceIsolation('taches'),
  ],
);

// Contact or company a Google meeting is about, chosen by the pilot when the guests' emails
// do not tell it (Google has no such notion: the link lives in the OS only).
export const rdvLiens = pgTable(
  'rdv_liens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    eventId: text('event_id').notNull(),
    contactId: uuid('contact_id').references(() => contacts.id),
    entrepriseId: uuid('entreprise_id').references(() => entreprises.id),
  },
  (t) => [
    uniqueIndex('rdv_liens_event_idx').on(t.instanceId, t.eventId),
    instanceIsolation('rdv_liens'),
  ],
);

export const activites = pgTable(
  'activites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    // History of a record (Pipedrive timeline): note, appel, email, reunion.
    type: text('type').notNull(),
    contactId: uuid('contact_id').references(() => contacts.id),
    entrepriseId: uuid('entreprise_id').references(() => entreprises.id),
    opportuniteId: uuid('opportunite_id').references(() => opportunites.id),
    titre: text('titre'),
    at: timestamp('at', { withTimezone: true }).notNull(),
    resume: text('resume'),
  },
  (t) => [
    index('activites_instance_at_idx').on(t.instanceId, t.at),
    uniqueIndex('activites_source_idx').on(t.instanceId, t.source, t.sourceId),
    instanceIsolation('activites'),
  ],
);
