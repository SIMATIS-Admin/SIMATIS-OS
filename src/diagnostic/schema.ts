import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { entreprises } from '../crm/schema.js';
import { instanceIsolation, metierColumns } from '../db/columns.js';
import type { Dimensions } from './profil.js';
import type { ContenuRapport } from './rapport-word.js';
import type { ReponseQuestion } from './score.js';

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
export const DEMANDES = [
  'preparer_support',
  'support_final',
  'rapport',
  'restitution',
  'entretien',
] as const;
// Rapport remis au dirigeant, rédigé par Claude : 'en_cours' tant que le runner le rédige, 'pret'
// une fois son lien enregistré.
export const STATUTS_RAPPORT = ['aucun', 'en_cours', 'pret'] as const;
export type Demande = (typeof DEMANDES)[number];
// Une version du rapport : son contenu structuré, d'où le Word se régénère et que Claude révise.
export type VersionRapport = { version: number; le: string; contenu: ContenuRapport };
export type Diapositive = { titre: string; texte: string; notes: string };

// Un projet de diagnostic, pour une entreprise prospect de SIMATIS. Étapes : 1 préparation,
// 2 entretien et résultat de l'outil externe, 3 revue des préconisations, 4 rapport,
// 5 restitution et capitalisation.
export const diagnosticProjets = pgTable(
  'diagnostic_projets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    nom: text('nom').notNull(),
    activite: text('activite').notNull(),
    contexte: text('contexte').notNull().default(''),
    etape: integer('etape').notNull().default(1),
    // Étape la plus haute atteinte : revenir en arrière pour relire ne fait pas reculer le projet.
    etapeMax: integer('etape_max').notNull().default(1),
    dims: jsonb('dims').$type<Dimensions>(),
    statutDiagnostic: text('statut_diagnostic'),
    dateDiagnostic: date('date_diagnostic'),
    chats: jsonb('chats').$type<Record<string, ChatEtape>>().notNull().default({}),
    // Formulaire de revue tel qu'il était dans l'artifact (commentaires de Marc), copié à l'import.
    revue: jsonb('revue').$type<Record<string, unknown>>(),
    // Rapport remis au dirigeant : fichier Word encodé en base64, avec son nom d'origine.
    rapport: text('rapport'),
    rapportNom: text('rapport_nom'),
    // Rapport rédigé par Claude : lien vers l'artifact affiché, et l'historique des liens précédents.
    rapportLienStatut: text('rapport_lien_statut', { enum: STATUTS_RAPPORT })
      .notNull()
      .default('aucun'),
    rapportLien: text('rapport_lien'),
    rapportLiens: jsonb('rapport_liens')
      .$type<{ lien: string; le: string }[]>()
      .notNull()
      .default([]),
    // Versions du rapport rédigées par Claude (la dernière est le Word affiché). Un Word importé
    // compte pour la version 1 sans contenu : la première version rédigée porte alors le numéro 2.
    rapportVersions: jsonb('rapport_versions').$type<VersionRapport[]>().notNull().default([]),
    // Deck de restitution (étape 5) : statut, lien du deck affiché, historique, et choix d'y
    // inclure ou non la proposition de collaboration (dernière diapositive).
    restitutionStatut: text('restitution_statut', { enum: STATUTS_RAPPORT })
      .notNull()
      .default('aucun'),
    restitutionLien: text('restitution_lien'),
    restitutionLiens: jsonb('restitution_liens')
      .$type<{ lien: string; le: string }[]>()
      .notNull()
      .default([]),
    restitutionAvecProposition: boolean('restitution_avec_proposition').notNull().default(true),
    // Entretien : PDF de l'outil externe (base64) et ses réponses lues par Claude, par question.
    pdfEntretien: text('pdf_entretien'),
    pdfEntretienNom: text('pdf_entretien_nom'),
    reponsesEntretien: jsonb('reponses_entretien').$type<ReponseQuestion[]>().notNull().default([]),
    // Corrections des réponses, avec l'ancienne et la nouvelle valeur (question = rubrique#numéro).
    historiqueReponses: jsonb('historique_reponses')
      .$type<{ question: string; ancienne: string; nouvelle: string; le: string }[]>()
      .notNull()
      .default([]),
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
    // Facultatif : les projets créés avant la fusion Diagnostics n'ont pas encore d'entreprise.
    entrepriseId: uuid('entreprise_id').references(() => entreprises.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('diagnostic_projets_instance_idx').on(t.instanceId),
    index('diagnostic_projets_entreprise_idx').on(t.entrepriseId),
    instanceIsolation('diagnostic_projets'),
  ],
);

export type Projet = typeof diagnosticProjets.$inferSelect;
