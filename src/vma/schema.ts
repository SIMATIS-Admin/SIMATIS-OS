import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { entreprises } from '../crm/schema.js';
import { instanceIsolation, metierColumns } from '../db/columns.js';

// Test de VMA : auto-diagnostic envoyé par invitation depuis le site. Une ligne par invitation ;
// le résultat est copié dans la même ligne à la relève. 'essai' n'entre ni dans l'historique ni
// dans la règle du semestre (cahier des charges, §5.1).
export const TYPES_TEST_VMA = ['premier', 'essai'] as const;
export const STATUTS_TEST_VMA = ['envoyee', 'utilisee', 'revoquee'] as const;
// Une relance réellement envoyée (une simulation n'est pas gardée) : à la main ou par le passage quotidien.
export type Relance = { le: string; origine: 'manuelle' | 'auto' };
export type TypeTestVma = (typeof TYPES_TEST_VMA)[number];
export type StatutTestVma = (typeof STATUTS_TEST_VMA)[number];

export const vmaTests = pgTable(
  'vma_tests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    entrepriseId: uuid('entreprise_id').references(() => entreprises.id),
    entrepriseNom: text('entreprise_nom').notNull(),
    // Dirigeant qui passe le test : reste dans l'OS, jamais envoyé au site (il sert au brouillon du résultat).
    contactNom: text('contact_nom'),
    contactEmail: text('contact_email'),
    // Registre des mails : vouvoiement par défaut ; la relance reprend celui de l'invitation.
    tutoiement: boolean('tutoiement').notNull().default(false),
    // Dernier envoi réel du mail d'invitation, et relances réelles depuis (le suivi de la fenêtre).
    envoyeeLe: timestamp('envoyee_le', { withTimezone: true }),
    relances: jsonb('relances').$type<Relance[]>().notNull().default([]),
    echecEnvoi: text('echec_envoi'),
    // Suivi relevé du site : première ouverture du mail (pixel, indicatif) et du lien. Jamais écrasé par une date plus tardive.
    mailOuvertLe: timestamp('mail_ouvert_le', { withTimezone: true }),
    lienOuvertLe: timestamp('lien_ouvert_le', { withTimezone: true }),
    // Relance automatique : faux pour les invitations d'avant la routine, que Marc relance à la main.
    relanceAuto: boolean('relance_auto').notNull().default(true),
    type: text('type', { enum: TYPES_TEST_VMA }).notNull(),
    statut: text('statut', { enum: STATUTS_TEST_VMA }).notNull().default('envoyee'),
    // Identifiant d'invitation (128 bits) : il fait partie du lien envoyé au dirigeant.
    invitationId: text('invitation_id').notNull().unique(),
    lien: text('lien').notNull(),
    expireLe: timestamp('expire_le', { withTimezone: true }).notNull(),
    // Résultat, rempli à la relève. Identifiant du résultat côté site : une relève ne le crée qu'une fois.
    resultatId: text('resultat_id').unique(),
    recueLe: timestamp('recue_le', { withTimezone: true }),
    version: text('version'),
    parametres: jsonb('parametres').$type<Record<string, unknown>>(),
    reponses: jsonb('reponses').$type<Record<string, unknown>>(),
    calcul: jsonb('calcul').$type<Record<string, unknown>>(),
    ecran: jsonb('ecran').$type<Record<string, unknown>>(),
  },
  (t) => [index('vma_tests_instance_idx').on(t.instanceId), instanceIsolation('vma_tests')],
);

export type TestVma = typeof vmaTests.$inferSelect;
