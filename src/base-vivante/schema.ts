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
import type { Correspondance, MemoireColonnes } from './colonnes.js';
import { ZONES } from './completude.js';
import type { Fiche } from './nettoyage.js';

export const STATUTS_IMPORT = ['apercu', 'integre'] as const;
export type StatutImport = (typeof STATUTS_IMPORT)[number];

// `pret` lines wait for integration; `sous_minimum` ones stay in the airlock with their reason;
// `doublon_interne` ones were merged into an earlier line of the same file.
export const STATUTS_LIGNE = ['pret', 'sous_minimum', 'doublon_interne', 'integre'] as const;
export type StatutLigne = (typeof STATUTS_LIGNE)[number];

export const RESULTATS = [
  'sans_reponse',
  'repondu',
  'interesse',
  'pas_interesse',
  'mauvais_interlocuteur',
  'reponse_auto',
] as const;
export type Resultat = (typeof RESULTATS)[number];
export const STATUTS_PROSPECTION = ['jamais_contacte', 'contacte', 'a_repondu'] as const;
export type StatutProspection = (typeof STATUTS_PROSPECTION)[number];
export const EXCLUSIONS = ['client', 'partenaire', 'concurrent'] as const;
export type Exclusion = (typeof EXCLUSIONS)[number];

export type RapportImport = {
  creees: number;
  fusionnees: number;
};

// One import = one sheet of one file. `source` of metierColumns is the tool a record was copied
// from; the origin of the list (Sharp, LinkedIn…) is `provenance`.
export const baseImports = pgTable(
  'base_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    nomFichier: text('nom_fichier').notNull(),
    feuille: text('feuille').notNull(),
    provenance: text('provenance').notNull(),
    mandat: text('mandat'),
    collecteLe: date('collecte_le'),
    statut: text('statut', { enum: STATUTS_IMPORT }).notNull().default('apercu'),
    entetes: jsonb('entetes').$type<string[]>().notNull(),
    correspondance: jsonb('correspondance').$type<Correspondance>().notNull(),
    rapport: jsonb('rapport').$type<RapportImport>(),
  },
  (t) => [index('base_imports_instance_idx').on(t.instanceId), instanceIsolation('base_imports')],
);

export const baseLignesBrutes = pgTable(
  'base_lignes_brutes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    importId: uuid('import_id')
      .notNull()
      .references(() => baseImports.id, { onDelete: 'cascade' }),
    // Line number in the sheet (1 = first line under the header).
    numero: integer('numero').notNull(),
    brut: jsonb('brut').$type<string[]>().notNull(),
    // Hand-completed fields (sas edits), applied over what the columns give.
    complements: jsonb('complements').$type<Record<string, string>>(),
    fiche: jsonb('fiche').$type<Fiche>().notNull(),
    statut: text('statut', { enum: STATUTS_LIGNE }).notNull(),
    zone: text('zone', { enum: ZONES }),
    raison: text('raison'),
    avertissements: jsonb('avertissements').$type<string[]>().notNull().default([]),
    ficheId: uuid('fiche_id'),
  },
  (t) => [
    index('base_lignes_import_idx').on(t.importId, t.numero),
    index('base_lignes_instance_idx').on(t.instanceId),
    instanceIsolation('base_lignes_brutes'),
  ],
);

// The living base. Only integration.ts writes here (see integration.test.ts).
export const baseVivante = pgTable(
  'base_vivante',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    zone: text('zone', { enum: ZONES }).notNull(),
    entreprise: text('entreprise').notNull(),
    civilite: text('civilite', { enum: ['M.', 'Mme'] }),
    civiliteDeduite: boolean('civilite_deduite').notNull().default(false),
    prenom: text('prenom'),
    nom: text('nom').notNull(),
    email: text('email'),
    telephone: text('telephone'),
    fonction: text('fonction'),
    linkedin: text('linkedin'),
    domaine: text('domaine'),
    provenance: text('provenance').notNull(),
    mandat: text('mandat'),
    importId: uuid('import_id').references(() => baseImports.id, { onDelete: 'set null' }),
    collecteLe: date('collecte_le'),
    // Duplicate keys (nettoyage.ts, clesDoublon): one stored record per key.
    cles: jsonb('cles').$type<string[]>().notNull().default([]),
    // History: read from the CRMs of every mandate and from a mandate's mailbox, never typed in.
    dernierContactLe: timestamp('dernier_contact_le', { withTimezone: true }),
    dernierContactCanal: text('dernier_contact_canal'),
    resultat: text('resultat', { enum: RESULTATS }),
    nbContacts: integer('nb_contacts').notNull().default(0),
    mandatContacteur: text('mandat_contacteur'),
    statutProspection: text('statut_prospection', { enum: STATUTS_PROSPECTION })
      .notNull()
      .default('jamais_contacte'),
    // Compliance: an opposition wins over everything else.
    emailInvalide: boolean('email_invalide').notNull().default(false),
    opposition: boolean('opposition').notNull().default(false),
    exclusion: text('exclusion', { enum: EXCLUSIONS }),
    // Set when the record entered the CRM of a mandate (first contact): keeps the link for history.
    crmMandat: text('crm_mandat'),
    crmContactId: uuid('crm_contact_id'),
  },
  (t) => [
    index('base_vivante_instance_idx').on(t.instanceId, t.zone),
    index('base_vivante_cles_idx').using('gin', t.cles),
    instanceIsolation('base_vivante'),
  ],
);

// A reply read in a mandate's mailbox, with the class Claude proposed; the pilot validates it.
// Mail content stays in this local database, never in the repository.
export const baseReponses = pgTable(
  'base_reponses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    ficheId: uuid('fiche_id')
      .notNull()
      .references(() => baseVivante.id, { onDelete: 'cascade' }),
    mandat: text('mandat').notNull(),
    messageId: text('message_id').notNull(),
    recuLe: timestamp('recu_le', { withTimezone: true }).notNull(),
    objet: text('objet'),
    extrait: text('extrait').notNull().default(''),
    auto: boolean('auto').notNull().default(false),
    classe: text('classe', { enum: [...RESULTATS, 'ne_plus_contacter'] }),
    validee: boolean('validee').notNull().default(false),
  },
  (t) => [
    uniqueIndex('base_reponses_message_idx').on(t.instanceId, t.messageId),
    index('base_reponses_fiche_idx').on(t.ficheId),
    instanceIsolation('base_reponses'),
  ],
);

// What the OS remembers per source: a format already seen goes through without a question.
export const baseCorrespondances = pgTable(
  'base_correspondances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    provenance: text('provenance').notNull(),
    memoire: jsonb('memoire').$type<MemoireColonnes>().notNull(),
    misAJourLe: timestamp('mis_a_jour_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('base_correspondances_provenance_idx').on(t.instanceId, t.provenance),
    instanceIsolation('base_correspondances'),
  ],
);

export type BaseImport = typeof baseImports.$inferSelect;
export type LigneBrute = typeof baseLignesBrutes.$inferSelect;
export type FicheBase = typeof baseVivante.$inferSelect;
export type ReponseBase = typeof baseReponses.$inferSelect;
