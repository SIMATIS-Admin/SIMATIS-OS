import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseVivante } from '../base-vivante/schema.js';
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
    // Envoi par Chrome : tant que l'essai est actif, l'exécuteur ouvre le profil et décrit ce qu'il
    // voit sans rien cliquer. Actif par défaut : on passe à l'envoi réel en connaissance de cause.
    essaiABlanc: boolean('essai_a_blanc').notNull().default(true),
    // Pause posée par l'OS (avertissement de LinkedIn) : elle dure jusqu'à `pauseJusqua`.
    pauseRaison: text('pause_raison'),
    pauseJusqua: timestamp('pause_jusqua', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('salesnav_reglages_instance_idx').on(t.instanceId),
    instanceIsolation('salesnav_reglages'),
  ],
);

// Journal du canal : une ligne par demande de connexion ou message, envoyé ou reçu. C'est lui qui
// alimente les compteurs de la sous-section SalesNav et la barre de l'état commercial.
export const ORIGINES_ACTION_SALESNAV = ['manuel', 'chrome'] as const;
export type OrigineActionSalesnav = (typeof ORIGINES_ACTION_SALESNAV)[number];
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
    // Qui a fait le clic sur LinkedIn : le pilote lui-même ou l'exécuteur dans son Chrome.
    origine: text('origine', { enum: ORIGINES_ACTION_SALESNAV }).notNull().default('manuel'),
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

// Le pipe du canal : une personne proposée puis suivie jusqu'à sa réponse. `file` : choisie mais pas
// encore proposée ; `propose` : à valider aujourd'hui ; `demande_envoyee` : en attente d'acceptation ;
// `connecte` : demande acceptée, on peut lui écrire ; `a_repondu` : a répondu à un message ;
// `sans_reponse` : plus de nouvelles, à retirer ; `ecarte` : jamais contactée ou retirée.
export const STATUTS_PROSPECT_SALESNAV = [
  'file',
  'propose',
  'demande_envoyee',
  'connecte',
  'a_repondu',
  'sans_reponse',
  'ecarte',
] as const;
export type StatutProspectSalesnav = (typeof STATUTS_PROSPECT_SALESNAV)[number];

export const salesnavProspects = pgTable(
  'salesnav_prospects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    // Fiche de la Base des suspects d'où vient la personne, quand elle en vient.
    baseId: uuid('base_id').references(() => baseVivante.id, { onDelete: 'set null' }),
    nom: text('nom').notNull(),
    fonction: text('fonction'),
    entreprise: text('entreprise'),
    lienLinkedin: text('lien_linkedin').notNull(),
    // Cible des messages (le même code que les modèles par défaut).
    cible: text('cible'),
    statut: text('statut', { enum: STATUTS_PROSPECT_SALESNAV }).notNull().default('file'),
    proposeLe: timestamp('propose_le', { withTimezone: true }),
    demandeLe: timestamp('demande_le', { withTimezone: true }),
    accepteLe: timestamp('accepte_le', { withTimezone: true }),
    reponduLe: timestamp('repondu_le', { withTimezone: true }),
    dernierMessageLe: timestamp('dernier_message_le', { withTimezone: true }),
    nbMessages: integer('nb_messages').notNull().default(0),
    // Opportunité créée dans le Radar à la première réponse.
    opportuniteId: uuid('opportunite_id').references(() => opportunites.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    uniqueIndex('salesnav_prospects_lien_idx').on(t.instanceId, t.lienLinkedin),
    index('salesnav_prospects_statut_idx').on(t.instanceId, t.statut),
    instanceIsolation('salesnav_prospects'),
  ],
);
export type ProspectSalesnav = typeof salesnavProspects.$inferSelect;

// File d'envoi par Chrome : une demande de connexion validée par le pilote, que l'exécuteur
// réalise dans son navigateur. Une seule peut être ouverte (en attente ou en cours) à la fois.
// `essai` : l'exécuteur n'a rien cliqué, il a seulement décrit ce qu'il voyait.
export const STATUTS_ENVOI_SALESNAV = [
  'en_attente',
  'en_cours',
  'envoye',
  'essai',
  'echec',
] as const;
export type StatutEnvoiSalesnav = (typeof STATUTS_ENVOI_SALESNAV)[number];

export const salesnavEnvois = pgTable(
  'salesnav_envois',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => salesnavProspects.id, { onDelete: 'cascade' }),
    note: text('note').notNull(),
    statut: text('statut', { enum: STATUTS_ENVOI_SALESNAV }).notNull().default('en_attente'),
    essai: boolean('essai').notNull().default(true),
    detail: text('detail'),
    termineLe: timestamp('termine_le', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('salesnav_envois_ouvert_idx')
      .on(t.instanceId)
      .where(sql`statut in ('en_attente', 'en_cours')`),
    index('salesnav_envois_prospect_idx').on(t.prospectId, t.createdAt),
    instanceIsolation('salesnav_envois'),
  ],
);
export type EnvoiSalesnav = typeof salesnavEnvois.$inferSelect;

export type CampagneSalesnav = typeof salesnavCampagnes.$inferSelect;
export type ModeleSalesnav = typeof salesnavModeles.$inferSelect;
