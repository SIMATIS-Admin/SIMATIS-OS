import { date, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

// Support d'ouverture : un deck par projet sur claude.ai. 'preparation' tant que Claude le crée,
// 'pret' une fois son lien enregistré, 'final' quand son texte est archivé.
export const STATUTS_SUPPORT = ['aucun', 'preparation', 'pret', 'final'] as const;
export type StatutSupport = (typeof STATUTS_SUPPORT)[number];
// Travail demandé au runner avec le message du pilote (sans : une simple réponse dans le chat).
export const DEMANDES = ['preparer_support', 'support_final'] as const;
export type Demande = (typeof DEMANDES)[number];
export type Diapositive = { titre: string; texte: string; notes: string };

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
    demande: text('demande', { enum: DEMANDES }),
    // Formulaire de l'étape 1, lu par Claude pour adapter le support.
    ditParDirigeant: text('dit_par_dirigeant').notNull().default(''),
    hypotheses: text('hypotheses').notNull().default(''),
    // Logo de l'entreprise (image en base64), donné à Claude pour la couverture du deck.
    logo: text('logo'),
    logoNom: text('logo_nom'),
    supportStatut: text('support_statut', { enum: STATUTS_SUPPORT }).notNull().default('aucun'),
    supportLien: text('support_lien'),
    supportTexte: jsonb('support_texte').$type<Diapositive[]>(),
    supportFinalLe: timestamp('support_final_le', { withTimezone: true }),
  },
  (t) => [
    index('diagnostic_projets_instance_idx').on(t.instanceId),
    instanceIsolation('diagnostic_projets'),
  ],
);

export type Projet = typeof diagnosticProjets.$inferSelect;
