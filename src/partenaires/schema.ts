import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { EtatEchange } from 'os-agents-relay';
import { instanceIsolation, metierColumns } from '../db/columns.js';
import { propositions } from '../propositions/schema.js';

// Objects of the CRM profile (kit, profile crm/1) a partner may see (« Alpes OS voit »).
export const OBJETS_CRM = [
  'entreprise',
  'contact',
  'affaire',
  'tache',
  'rendez_vous',
  'activite',
] as const;
export type ObjetCrm = (typeof OBJETS_CRM)[number];

// Fields the pilot can keep from a partner, like the excluded fields of the HubSpot sync. Required
// fields of the profile are not in the list: the partner's copy needs them.
export const CHAMPS_EXCLUABLES = [
  { cle: 'contact.telephone', libelle: 'Téléphone' },
  { cle: 'contact.email', libelle: 'Emails' },
  { cle: 'contact.fonction', libelle: 'Fonction' },
  { cle: 'entreprise.taille', libelle: 'Effectif' },
  { cle: 'affaire.montant', libelle: 'Montant' },
  { cle: 'affaire.echeance', libelle: 'Échéance' },
  { cle: 'affaire.proprietaire', libelle: 'Propriétaire' },
  { cle: 'affaire.motif', libelle: 'Motif de perte' },
  { cle: 'tache.notes', libelle: 'Notes des tâches' },
  { cle: 'rendez_vous.compte_rendu', libelle: 'Comptes rendus' },
  { cle: 'activite.resume', libelle: 'Contenu des activités' },
] as const;
export type ChampExcluable = (typeof CHAMPS_EXCLUABLES)[number]['cle'];

// What leaves for a partner. The qualification of a deal (qualification, potentiel, faisabilite)
// is Marc's call, connection by connection: off by default.
export type Voit = { objets: ObjetCrm[]; champsExclus: ChampExcluable[]; qualification: boolean };
export const VOIT_DEFAUT: Voit = {
  objets: [...OBJETS_CRM],
  champsExclus: [],
  qualification: false,
};

export const ETATS_MISSION = [
  'simulation',
  'submitted',
  'working',
  'input-required',
  'completed',
  'failed',
  'canceled',
  'rejected',
] as const;
export type EtatMissionLocal = (typeof ETATS_MISSION)[number];

export type EntreeHistorique = {
  etat: EtatMissionLocal | null;
  at: string;
  message: string | null;
  enveloppe: string | null;
};

// One row per connection of the agents relay: another OS this instance works with.
export const partenaires = pgTable(
  'partenaires',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    connexionId: text('connexion_id').notNull(),
    noeudId: text('noeud_id').notNull(),
    nom: text('nom').notNull(),
    carte: jsonb('carte').$type<Record<string, unknown>>(),
    // What the OS does with a mission received from this partner (L0 to L3).
    niveau: text('niveau', { enum: ['L0', 'L1', 'L2', 'L3'] })
      .notNull()
      .default('L0'),
    voit: jsonb('voit').$type<Voit>().notNull().default(VOIT_DEFAUT),
    statut: text('statut', { enum: ['active', 'coupee'] })
      .notNull()
      .default('active'),
    coupeeAt: timestamp('coupee_at', { withTimezone: true }),
    // CRM sync (synchro.ts): snapshot sent, last pass, last full pass.
    instantaneAt: timestamp('instantane_at', { withTimezone: true }),
    synchroAt: timestamp('synchro_at', { withTimezone: true }),
    passeCompleteAt: timestamp('passe_complete_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('partenaires_connexion_idx').on(t.instanceId, t.connexionId),
    instanceIsolation('partenaires'),
  ],
);

export type Partenaire = typeof partenaires.$inferSelect;

// Invitations created here (Paramètres > Partenaires) and not yet used: the link is handed to the
// partner by hand, the relay tells us when it is accepted (connexion envelope).
export const invitationsPartenaires = pgTable(
  'invitations_partenaires',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    code: text('code').notNull(),
    lien: text('lien').notNull(),
    // Label only: the OS sends no mail.
    email: text('email'),
    expireAt: timestamp('expire_at', { withTimezone: true }).notNull(),
    accepteeAt: timestamp('acceptee_at', { withTimezone: true }),
    connexionId: text('connexion_id'),
    creePar: text('cree_par'),
  },
  (t) => [
    uniqueIndex('invitations_partenaires_code_idx').on(t.instanceId, t.code),
    instanceIsolation('invitations_partenaires'),
  ],
);

export type InvitationPartenaire = typeof invitationsPartenaires.$inferSelect;

// Missions entrusted to a partner, or received from it. `id` is the A2A task id, shared with the
// partner.
export const missions = pgTable(
  'missions',
  {
    id: text('id').primaryKey(),
    ...metierColumns(),
    partenaireId: uuid('partenaire_id')
      .notNull()
      .references(() => partenaires.id),
    sens: text('sens', { enum: ['envoyee', 'recue'] }).notNull(),
    titre: text('titre').notNull(),
    consigne: text('consigne').notNull(),
    contexte: jsonb('contexte').$type<Record<string, unknown>>(),
    etat: text('etat', { enum: ETATS_MISSION }).notNull(),
    dernierMessage: text('dernier_message'),
    resultat: jsonb('resultat').$type<Record<string, unknown>>(),
    historique: jsonb('historique').$type<EntreeHistorique[]>().notNull().default([]),
    propositionId: uuid('proposition_id').references(() => propositions.id),
    confieePar: text('confiee_par'),
    // A2A context of the task: the states sent back carry it.
    contextId: text('context_id'),
    // Received mission: the partner's level when it arrived (what the agent may do with it).
    niveau: text('niveau', { enum: ['L0', 'L1', 'L2', 'L3'] }),
  },
  (t) => [
    index('missions_partenaire_idx').on(t.instanceId, t.partenaireId),
    instanceIsolation('missions'),
  ],
);

export type MissionPartenaire = typeof missions.$inferSelect;

// Types of a free message (kit, messageLibre).
export const TYPES_MESSAGE = ['question', 'reponse', 'info'] as const;
export type TypeMessage = (typeof TYPES_MESSAGE)[number];

// Free Markdown messages exchanged with a partner, outside any mission (they replace the
// `echanges/` folder of the shared space). `id` is the A2A message id: a reply points to it.
export const messagesPartenaires = pgTable(
  'messages_partenaires',
  {
    id: text('id').primaryKey(),
    ...metierColumns(),
    partenaireId: uuid('partenaire_id')
      .notNull()
      .references(() => partenaires.id),
    sens: text('sens', { enum: ['envoye', 'recu'] }).notNull(),
    type: text('type', { enum: TYPES_MESSAGE }).notNull(),
    sujet: text('sujet').notNull(),
    texte: text('texte').notNull(),
    enReponseA: text('en_reponse_a'),
    // Real writes closed: recorded, nothing left.
    simulation: boolean('simulation').notNull().default(false),
    propositionId: uuid('proposition_id').references(() => propositions.id),
    envoyePar: text('envoye_par'),
  },
  (t) => [
    index('messages_partenaires_idx').on(t.instanceId, t.partenaireId),
    instanceIsolation('messages_partenaires'),
  ],
);

export type MessagePartenaire = typeof messagesPartenaires.$inferSelect;

// Shared objects plus the pipeline, which travels with them.
export const OBJETS_SYNCHRO = ['pipeline', ...OBJETS_CRM] as const;
export type ObjetSynchro = (typeof OBJETS_SYNCHRO)[number];

// Last state exchanged with a partner, per shared record (kit EtatEchange: fields, links and the
// date of each): what was sent or received last. A change is what differs from it, so a received
// change (written here too) never goes back. `ref` is the record's reference in the CRM profile:
// `<origin node>/<local id>`. `detacheAt`: the record left the share (deleted on the other side,
// Marc decides): it no longer syncs.
export const crmPartages = pgTable(
  'crm_partages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    partenaireId: uuid('partenaire_id')
      .notNull()
      .references(() => partenaires.id),
    objet: text('objet', { enum: OBJETS_SYNCHRO }).notNull(),
    localId: uuid('local_id'),
    ref: text('ref').notNull(),
    etat: jsonb('etat').$type<EtatEchange>().notNull(),
    detacheAt: timestamp('detache_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('crm_partages_ref_idx').on(t.instanceId, t.partenaireId, t.ref),
    index('crm_partages_local_idx').on(t.instanceId, t.partenaireId, t.objet, t.localId),
    instanceIsolation('crm_partages'),
  ],
);

export type CrmPartage = typeof crmPartages.$inferSelect;

// The kit's outbox: envelopes waiting to be posted to the relay, retried until accepted.
export const relaisSorties = pgTable(
  'relais_sorties',
  {
    id: text('id').primaryKey(),
    ...metierColumns(),
    connexionId: text('connexion_id').notNull(),
    type: text('type').notNull(),
    corps: jsonb('corps').$type<Record<string, unknown>>().notNull(),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull(),
    prochainEssai: timestamp('prochain_essai', { withTimezone: true }),
  },
  () => [instanceIsolation('relais_sorties')],
);

// Envelopes already handled: the relay may deliver one twice, it is processed once.
export const relaisVus = pgTable(
  'relais_vus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    enveloppeId: text('enveloppe_id').notNull(),
    vuAt: timestamp('vu_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('relais_vus_enveloppe_idx').on(t.instanceId, t.enveloppeId),
    instanceIsolation('relais_vus'),
  ],
);
