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
import { opportunites } from '../crm/schema.js';
import { instanceIsolation, metierColumns } from '../db/columns.js';

// Unit price stays null until the pilot sets it: the OS never proposes a price or a discount.
// `prixPropose` is the deal's amount offered as a suggestion only: it never counts in a total
// until the pilot copies it into `prixUnitaire`.
export type UniteDevis = 'forfait' | 'jour' | 'mois' | 'personne' | 'heure';
export type LigneDevis = {
  libelle: string;
  unite: UniteDevis;
  quantite: number;
  prixUnitaire: number | null;
  prixPropose?: number | null;
};
// Clause texts are the pilot's own: they live in the database, never in the code.
export type Clause = { titre: string; texte: string; active: boolean };

export const devis = pgTable(
  'devis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    opportuniteId: uuid('opportunite_id')
      .notNull()
      .references(() => opportunites.id),
    numero: text('numero').notNull(),
    statut: text('statut', { enum: ['brouillon', 'valide', 'transmis'] })
      .notNull()
      .default('brouillon'),
    version: integer('version').notNull().default(1),
    titre: text('titre').notNull().default(''),
    contexte: text('contexte').notNull().default(''),
    objectifs: text('objectifs').notNull().default(''),
    inclus: text('inclus').notNull().default(''),
    exclu: text('exclu').notNull().default(''),
    livrables: text('livrables').notNull().default(''),
    duree: text('duree').notNull().default(''),
    debut: date('debut'),
    remisePct: integer('remise_pct').notNull().default(0),
    acomptePct: integer('acompte_pct').notNull().default(0),
    frais: text('frais', { enum: ['refactures', 'inclus'] })
      .notNull()
      .default('refactures'),
    validiteJours: integer('validite_jours').notNull().default(30),
    clauses: jsonb('clauses').$type<Clause[]>().notNull().default([]),
    lignes: jsonb('lignes').$type<LigneDevis[]>().notNull().default([]),
    envoyeLe: timestamp('envoye_le', { withTimezone: true }),
    validite: date('validite'),
  },
  (t) => [
    index('devis_instance_idx').on(t.instanceId),
    uniqueIndex('devis_numero_idx').on(t.instanceId, t.numero),
    instanceIsolation('devis'),
  ],
);

export type Devis = typeof devis.$inferSelect;

// The pilot's own quote settings and libraries: they live in the database, never in the code.
export const devisReglages = pgTable(
  'devis_reglages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    numerotation: text('numerotation').notNull().default('DEV-{AAAA}-{NNN}'),
    mentions: text('mentions').notNull().default(''),
    tvaPct: integer('tva_pct').notNull().default(20),
    validiteJours: integer('validite_jours').notNull().default(30),
    acomptePct: integer('acompte_pct').notNull().default(0),
  },
  (t) => [
    uniqueIndex('devis_reglages_instance_idx').on(t.instanceId),
    instanceIsolation('devis_reglages'),
  ],
);

export const devisClauses = pgTable(
  'devis_clauses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    titre: text('titre').notNull(),
    texte: text('texte').notNull().default(''),
    parDefaut: boolean('par_defaut').notNull().default(false),
    ordre: integer('ordre').notNull().default(0),
  },
  (t) => [index('devis_clauses_instance_idx').on(t.instanceId), instanceIsolation('devis_clauses')],
);

// A mission model never carries a price: lines hold a label, a unit and a quantity only.
export type LigneModele = { libelle: string; unite: UniteDevis; quantite: number };
export const devisModeles = pgTable(
  'devis_modeles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    nom: text('nom').notNull(),
    contexte: text('contexte').notNull().default(''),
    objectifs: text('objectifs').notNull().default(''),
    inclus: text('inclus').notNull().default(''),
    exclu: text('exclu').notNull().default(''),
    livrables: text('livrables').notNull().default(''),
    duree: text('duree').notNull().default(''),
    lignes: jsonb('lignes').$type<LigneModele[]>().notNull().default([]),
  },
  (t) => [index('devis_modeles_instance_idx').on(t.instanceId), instanceIsolation('devis_modeles')],
);
