import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Données du compte (les abonnements Claude et ChatGPT de Marc), pas d'une instance : tables
// globales, sans instance_id ni RLS, et hors de METIER_TABLES pour échapper à la purge d'instance.

export const FOURNISSEURS_IA = ['claude', 'chatgpt'] as const;
export type FournisseurConso = (typeof FOURNISSEURS_IA)[number];
export const OUTILS_IA = ['code', 'cowork', 'codex', 'agent', 'executeur'] as const;
export type OutilIA = (typeof OUTILS_IA)[number];
export const ORIGINES_IA = ['ext', 'int'] as const;
export type OrigineIA = (typeof ORIGINES_IA)[number];

const jetons = () => ({
  entree: bigint('entree', { mode: 'number' }).notNull(),
  sortie: bigint('sortie', { mode: 'number' }).notNull(),
  cacheEcriture: bigint('cache_ecriture', { mode: 'number' }).notNull(),
  cacheLecture: bigint('cache_lecture', { mode: 'number' }).notNull(),
});

// Une session d'un outil IA vue sur le Mac (Claude Code, Cowork, Codex) ou lancée par l'exécuteur.
export const iaSessions = pgTable('ia_sessions', {
  id: text('id').primaryKey(),
  fournisseur: text('fournisseur', { enum: FOURNISSEURS_IA }).notNull(),
  outil: text('outil', { enum: OUTILS_IA }).notNull(),
  origine: text('origine', { enum: ORIGINES_IA }).notNull(),
  sujet: text('sujet').notNull(),
  branche: text('branche'),
  titre: text('titre'),
  cwd: text('cwd'),
  debut: timestamp('debut', { withTimezone: true }).notNull(),
  vuLe: timestamp('vu_le', { withTimezone: true }).notNull().defaultNow(),
});

// Jetons d'une session sur une heure, pour un modèle. Remplacé à chaque relevé, jamais additionné.
export const iaCumuls = pgTable(
  'ia_cumuls',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => iaSessions.id, { onDelete: 'cascade' }),
    heure: timestamp('heure', { withTimezone: true }).notNull(),
    modele: text('modele').notNull(),
    ...jetons(),
    cout: doublePrecision('cout').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.heure, t.modele] }),
    index('ia_cumuls_heure_idx').on(t.heure),
  ],
);

// Lancements déclarés par l'exécuteur : ce qui les rattache à l'OS (IA-int) et leur sujet.
export const iaLancements = pgTable('ia_lancements', {
  id: uuid('id').primaryKey().defaultRandom(),
  moteur: text('moteur', { enum: ['claude', 'codex'] }).notNull(),
  sessionId: text('session_id'),
  cwd: text('cwd'),
  debut: timestamp('debut', { withTimezone: true }).notNull(),
  sujet: text('sujet').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Historique des jauges : relevés du collecteur (toutes les 5 min) et ceux écrits par Codex.
export const iaJauges = pgTable(
  'ia_jauges',
  {
    fournisseur: text('fournisseur', { enum: FOURNISSEURS_IA }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    source: text('source', { enum: ['collecteur', 'codex'] }).notNull(),
    utilise5h: real('utilise_5h').notNull(),
    utiliseHebdo: real('utilise_hebdo').notNull(),
    reset5h: timestamp('reset_5h', { withTimezone: true }),
    resetHebdo: timestamp('reset_hebdo', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.fournisseur, t.at, t.source] })],
);

// État du relevé du Mac : la console signale un relevé muet ou des fichiers illisibles.
export const iaReleve = pgTable('ia_releve', {
  id: text('id').primaryKey(),
  dernierPassage: timestamp('dernier_passage', { withTimezone: true }).notNull(),
  anomalies: integer('anomalies').notNull().default(0),
  detail: text('detail'),
});

// Archive figée de chaque journée, pour les statistiques (13 mois).
export const iaArchive = pgTable(
  'ia_archive',
  {
    jour: date('jour').notNull(),
    heure: timestamp('heure', { withTimezone: true }).notNull(),
    origine: text('origine', { enum: ['ext', 'int', 'non_attribue'] }).notNull(),
    fournisseur: text('fournisseur', { enum: FOURNISSEURS_IA }).notNull(),
    // Vide pour le « non attribué » : la clé primaire veut une valeur, on garde donc ''.
    outil: text('outil').notNull().default(''),
    sujet: text('sujet').notNull(),
    ...jetons(),
    cout: doublePrecision('cout').notNull(),
    l5: real('l5'),
    lh: real('lh'),
    estime: boolean('estime').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.heure, t.origine, t.fournisseur, t.sujet, t.outil] }),
    index('ia_archive_jour_idx').on(t.jour),
  ],
);
