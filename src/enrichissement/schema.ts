import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { baseVivante } from '../base-vivante/schema.js';
import { instanceIsolation, metierColumns } from '../db/columns.js';

export const TYPES_ENRICHISSEMENT = ['contacts', 'completer'] as const;
export type TypeEnrichissement = (typeof TYPES_ENRICHISSEMENT)[number];
export const ETATS_TACHE = ['en_cours', 'terminee', 'interrompue'] as const;
export const ETATS_LIGNE = ['attente', 'en_cours', 'terminee', 'echec', 'ignoree'] as const;
export const ETATS_SUGGESTION = ['a_valider', 'acceptee', 'refusee'] as const;
export const CONFIANCES = ['haute', 'moyenne', 'basse'] as const;
export const MODES_EMAIL = ['trouve', 'deduit'] as const;

// Un lancement d'enrichissement sur un lot de fiches de la base vivante.
export const enrichissementTaches = pgTable(
  'enrichissement_taches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    type: text('type', { enum: TYPES_ENRICHISSEMENT }).notNull(),
    // Les fonctions recherchées, saisies par Marc à chaque lancement.
    profil: jsonb('profil').$type<string[]>().notNull(),
    maxParEntreprise: integer('max_par_entreprise').notNull(),
    etat: text('etat', { enum: ETATS_TACHE }).notNull(),
    jetons: integer('jetons').notNull().default(0),
    erreur: text('erreur'),
  },
  (t) => [
    index('enrichissement_taches_instance_idx').on(t.instanceId, t.createdAt),
    instanceIsolation('enrichissement_taches'),
  ],
);

// Une fiche dans un lancement : où elle en est, et pourquoi elle a été écartée le cas échéant.
export const enrichissementLignes = pgTable(
  'enrichissement_lignes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    tacheId: uuid('tache_id')
      .notNull()
      .references(() => enrichissementTaches.id, { onDelete: 'cascade' }),
    ficheId: uuid('fiche_id')
      .notNull()
      .references(() => baseVivante.id, { onDelete: 'cascade' }),
    etat: text('etat', { enum: ETATS_LIGNE }).notNull(),
    raison: text('raison'),
  },
  (t) => [
    index('enrichissement_lignes_tache_idx').on(t.tacheId),
    instanceIsolation('enrichissement_lignes'),
  ],
);

// Ce que l'IA a trouvé : rien n'entre dans une fiche tant que Marc ne l'a pas accepté.
export const enrichissementSuggestions = pgTable(
  'enrichissement_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    tacheId: uuid('tache_id')
      .notNull()
      .references(() => enrichissementTaches.id, { onDelete: 'cascade' }),
    ficheId: uuid('fiche_id')
      .notNull()
      .references(() => baseVivante.id, { onDelete: 'cascade' }),
    prenom: text('prenom'),
    nom: text('nom'),
    fonction: text('fonction'),
    email: text('email'),
    emailEntreprise: text('email_entreprise'),
    linkedin: text('linkedin'),
    telephone: text('telephone'),
    sourceUrl: text('source_url'),
    confiance: text('confiance', { enum: CONFIANCES }).notNull(),
    modeEmail: text('mode_email', { enum: MODES_EMAIL }),
    etat: text('etat', { enum: ETATS_SUGGESTION }).notNull().default('a_valider'),
  },
  (t) => [
    index('enrichissement_suggestions_tache_idx').on(t.tacheId),
    instanceIsolation('enrichissement_suggestions'),
  ],
);

export type Tache = typeof enrichissementTaches.$inferSelect;
export type Ligne = typeof enrichissementLignes.$inferSelect;
export type Suggestion = typeof enrichissementSuggestions.$inferSelect;

export const MODES_RECHERCHE = ['manuel', 'automatique'] as const;
export const ETATS_RECHERCHE = ['en_cours', 'terminee', 'incomplete', 'erreur'] as const;

// Historique des recherches de nouveaux prospects (lancées à la main ou par la routine quotidienne) :
// l'état courant de la recherche manuelle est écrasé à chaque lancement, ce journal garde chaque passage.
export const rechercheSessions = pgTable(
  'recherche_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    mode: text('mode', { enum: MODES_RECHERCHE }).notNull(),
    nombreVise: integer('nombre_vise').notNull(),
    trouves: integer('trouves').notNull().default(0),
    // Fiches créées / rapprochées à l'intégration : connues pour la routine, qui intègre elle-même.
    ajoutees: integer('ajoutees'),
    rapprochees: integer('rapprochees'),
    etat: text('etat', { enum: ETATS_RECHERCHE }).notNull().default('en_cours'),
    erreur: text('erreur'),
    finiLe: timestamp('fini_le', { withTimezone: true }),
  },
  (t) => [
    index('recherche_sessions_instance_idx').on(t.instanceId, t.createdAt),
    instanceIsolation('recherche_sessions'),
  ],
);
