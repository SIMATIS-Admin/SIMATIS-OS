import { date, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { instanceIsolation, metierColumns } from '../db/columns.js';
import type { Dimensions } from './profil.js';

// Conversation avec l'assistant Claude d'une étape : le chat vit sur claude.ai, l'OS garde son
// lien, le modèle et l'effort choisis pour le retrouver.
export const STATUTS_CHAT = ['repos', 'attente_claude', 'en_cours'] as const;
export type MessageDiag = {
  etape: number;
  de: 'pilote' | 'claude';
  texte: string;
  at: string;
  erreur?: boolean;
};

export type ChatEtape = { modele: string; effort: string; lien: string };

// Un projet de diagnostic, pour une entreprise prospect de SIMATIS. Étape 1 : préparation,
// étape 2 : résultat de l'outil externe, étape 3 : analyse et rapport.
export const diagnosticProjets = pgTable(
  'diagnostic_projets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    nom: text('nom').notNull(),
    activite: text('activite').notNull(),
    contexte: text('contexte').notNull().default(''),
    etape: integer('etape').notNull().default(1),
    dims: jsonb('dims').$type<Dimensions>(),
    statutDiagnostic: text('statut_diagnostic'),
    dateDiagnostic: date('date_diagnostic'),
    chats: jsonb('chats').$type<Record<string, ChatEtape>>().notNull().default({}),
    // Formulaire de revue tel qu'il était dans l'artifact (commentaires de Marc), copié à l'import.
    revue: jsonb('revue').$type<Record<string, unknown>>(),
    // Rapport remis au dirigeant : fichier Word encodé en base64, avec son nom d'origine.
    rapport: text('rapport'),
    rapportNom: text('rapport_nom'),
    // Conversation avec Claude (répondue par le runner de l'OS, comme l'Inbox) et son état :
    // 'repos', 'attente_claude' (le pilote a écrit), 'en_cours' (le runner travaille dessus).
    conversation: jsonb('conversation').$type<MessageDiag[]>().notNull().default([]),
    statutChat: text('statut_chat', { enum: STATUTS_CHAT }).notNull().default('repos'),
  },
  (t) => [
    index('diagnostic_projets_instance_idx').on(t.instanceId),
    instanceIsolation('diagnostic_projets'),
  ],
);

export type Projet = typeof diagnosticProjets.$inferSelect;
