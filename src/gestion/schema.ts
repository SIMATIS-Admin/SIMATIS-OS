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

// Gestion (instance « Mon activité » uniquement). Montants en centimes entiers, dates = jours de Paris.
// Une dépense est une série : ponctuelle (récurrence « aucune ») ou récurrente. Ses occurrences se
// calculent à la demande ; seules les réalisations et exceptions sont stockées (gestion_depense_exceptions).
export const STATUTS_DEPENSE = ['reelle', 'prevue'] as const;
export const RECURRENCES = ['aucune', 'mensuelle', 'trimestrielle', 'annuelle'] as const;
export const PAYEURS = ['societe', 'associe'] as const;
export const ETATS_OCCURRENCE_DEPENSE = ['payee', 'ignoree'] as const;
export type StatutDepense = (typeof STATUTS_DEPENSE)[number];
export type Recurrence = (typeof RECURRENCES)[number];

// Rattachement analytique : SIMATIS, KAIROS ou un mandat. Ce n'est pas une refacturation.
// Le mandat est désigné par son identifiant d'espace (slug) : aucun accès à ses données.
export type Affectation = { cible: 'simatis' | 'kairos' | 'mandat'; mandat?: string };

export const gestionDepenses = pgTable(
  'gestion_depenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    libelle: text('libelle').notNull(),
    categorie: text('categorie'),
    montantTtcCents: integer('montant_ttc_cents').notNull(),
    // Avancé, facultatif : sans valeur, la TVA n'est pas estimée.
    tvaCents: integer('tva_cents'),
    statut: text('statut', { enum: STATUTS_DEPENSE }).notNull(),
    recurrence: text('recurrence', { enum: RECURRENCES }).notNull().default('aucune'),
    // Première échéance (ou date unique) et dernière échéance éventuelle (incluse).
    dateDebut: date('date_debut', { mode: 'string' }).notNull(),
    dateFin: date('date_fin', { mode: 'string' }),
    payeur: text('payeur', { enum: PAYEURS }).notNull().default('societe'),
    affectations: jsonb('affectations').$type<Affectation[]>().notNull().default([]),
    // « Refacturable » est une intention ; la refacturation réelle est un revenu à part (Lot B).
    refacturable: boolean('refacturable').notNull().default(false),
    // Référence texte ou lien ; les pièces jointes viendront plus tard.
    justificatif: text('justificatif'),
    // Suppression douce : une dépense archivée disparaît des vues mais reste en base.
    archiveeAt: timestamp('archivee_at', { withTimezone: true }),
  },
  (t) => [
    index('gestion_depenses_instance_idx').on(t.instanceId, t.dateDebut),
    instanceIsolation('gestion_depenses'),
  ],
);

// Réalisation ou exception d'une occurrence : identifiée par (série, date d'origine) pour ne jamais
// doubler une occurrence quand la série est relue.
export const gestionDepenseExceptions = pgTable(
  'gestion_depense_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    depenseId: uuid('depense_id')
      .notNull()
      .references(() => gestionDepenses.id, { onDelete: 'cascade' }),
    dateOrigine: date('date_origine', { mode: 'string' }).notNull(),
    etat: text('etat', { enum: ETATS_OCCURRENCE_DEPENSE }).notNull(),
    // Écarts éventuels par rapport à la série (date réelle de paiement, montant réellement débité).
    datePaiement: date('date_paiement', { mode: 'string' }),
    montantTtcCents: integer('montant_ttc_cents'),
  },
  (t) => [
    uniqueIndex('gestion_depense_exceptions_occ_idx').on(t.depenseId, t.dateOrigine),
    instanceIsolation('gestion_depense_exceptions'),
  ],
);

// Recettes (CA en HT). Pour l'instant : recettes ponctuelles, par exemple une commission facturée à un
// mandat. Les états restent distincts : prévue, facturée (émise), encaissée.
export const TYPES_REVENU = ['commission', 'abonnement', 'refacturation', 'autre'] as const;
export const ETATS_REVENU = ['prevue', 'emise', 'encaissee'] as const;
export type EtatRevenu = (typeof ETATS_REVENU)[number];
// Une commission incertaine ne vaut jamais un encaissement certain.
export const CERTITUDES = ['certaine', 'probable', 'hypothese'] as const;
export type Certitude = (typeof CERTITUDES)[number];
export const ETATS_OCCURRENCE_REVENU = ['emise', 'encaissee', 'ignoree'] as const;

export const gestionRevenus = pgTable(
  'gestion_revenus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    libelle: text('libelle').notNull(),
    type: text('type', { enum: TYPES_REVENU }).notNull().default('commission'),
    // Slug du mandat concerné ; vide = non rattachée. Aucun accès aux données du mandat.
    mandat: text('mandat'),
    montantHtCents: integer('montant_ht_cents').notNull(),
    etat: text('etat', { enum: ETATS_REVENU }).notNull().default('prevue'),
    // Date prévue ou de facture ; la date d'encaissement est distincte.
    date: date('date', { mode: 'string' }).notNull(),
    dateEncaissement: date('date_encaissement', { mode: 'string' }),
    // Référence de la facture émise ailleurs : jamais une facture fabriquée ici.
    referenceFacture: text('reference_facture'),
    // TVA comprise dans le montant par échéance ; vide = non renseignée (jamais un taux supposé).
    tvaCents: integer('tva_cents'),
    // Série : première échéance = `date`, dernière éventuelle = `dateFin` ; l'état de chaque échéance
    // vit alors dans gestion_revenu_exceptions. Ponctuelle (« aucune ») : l'état est celui de la ligne.
    recurrence: text('recurrence', { enum: RECURRENCES }).notNull().default('aucune'),
    dateFin: date('date_fin', { mode: 'string' }),
    certitude: text('certitude', { enum: CERTITUDES }).notNull().default('certaine'),
    // Refacturation : la recette vient d'une dépense, sans jamais la réduire.
    depenseId: uuid('depense_id').references(() => gestionDepenses.id, { onDelete: 'set null' }),
    archiveeAt: timestamp('archivee_at', { withTimezone: true }),
  },
  (t) => [
    index('gestion_revenus_instance_idx').on(t.instanceId, t.date),
    instanceIsolation('gestion_revenus'),
  ],
);

// Réalisation d'une échéance de recette récurrente (facturée, encaissée ou ignorée).
export const gestionRevenuExceptions = pgTable(
  'gestion_revenu_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    revenuId: uuid('revenu_id')
      .notNull()
      .references(() => gestionRevenus.id, { onDelete: 'cascade' }),
    dateOrigine: date('date_origine', { mode: 'string' }).notNull(),
    etat: text('etat', { enum: ETATS_OCCURRENCE_REVENU }).notNull(),
    dateEncaissement: date('date_encaissement', { mode: 'string' }),
    montantHtCents: integer('montant_ht_cents'),
    referenceFacture: text('reference_facture'),
  },
  (t) => [
    uniqueIndex('gestion_revenu_exceptions_occ_idx').on(t.revenuId, t.dateOrigine),
    instanceIsolation('gestion_revenu_exceptions'),
  ],
);

// Réglages de trésorerie : un seul enregistrement par instance. Un solde sans date ni source n'existe pas,
// et aucun seuil ni délai n'a de valeur par défaut : ils se règlent à la main.
export const MODES_SEUIL = ['aucun', 'montant', 'bfr'] as const;
export type ModeSeuil = (typeof MODES_SEUIL)[number];
export const gestionReglages = pgTable(
  'gestion_reglages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    soldeCents: integer('solde_cents'),
    soldeDate: date('solde_date', { mode: 'string' }),
    soldeSource: text('solde_source'),
    seuilMode: text('seuil_mode', { enum: MODES_SEUIL }).notNull().default('aucun'),
    seuilCents: integer('seuil_cents'),
    delaiPaiementJours: integer('delai_paiement_jours'),
    // Hypothèses du modèle de projection : ce que retient chaque scénario et la rémunération du dirigeant.
    // Validé à la lecture par zod (tresorerie.ts) : une valeur absente retombe sur les réglages d'origine.
    modele: jsonb('modele'),
  },
  (t) => [
    uniqueIndex('gestion_reglages_instance_idx').on(t.instanceId),
    instanceIsolation('gestion_reglages'),
  ],
);

// Registre des lignes importées d'un export bancaire : la clé d'une ligne ne se réimporte jamais.
// Le fichier lui-même n'est pas conservé ; on garde la clé, la décision et ce qu'elle a produit.
export const DECISIONS_IMPORT = ['importee', 'rapprochee', 'ignoree'] as const;
export const gestionImportCles = pgTable(
  'gestion_import_cles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    cle: text('cle').notNull(),
    decision: text('decision', { enum: DECISIONS_IMPORT }).notNull(),
    cibleType: text('cible_type', { enum: ['depense', 'recette'] }),
    cibleId: uuid('cible_id'),
  },
  (t) => [
    uniqueIndex('gestion_import_cles_idx').on(t.instanceId, t.cle),
    instanceIsolation('gestion_import_cles'),
  ],
);

// TVA mensuelle : la déclaration est mensuelle (confirmé), l'exigibilité reste à confirmer. Le montant
// déclaré est saisi à la main, jamais transmis.
export const gestionTvaMois = pgTable(
  'gestion_tva_mois',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    mois: text('mois').notNull(),
    declareeCents: integer('declaree_cents'),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('gestion_tva_mois_idx').on(t.instanceId, t.mois),
    instanceIsolation('gestion_tva_mois'),
  ],
);

// IK et compte courant d'associé (Lot D). Aucune valeur réelle (commune, lieux, distances, taux) n'est
// dans le code : tout se saisit dans l'OS. Le fichier du comptable n'est jamais modifié.
export const ORIGINES_DISTANCE = ['calculee', 'convention_comptable', 'saisie'] as const;
export const STATUTS_IK = [
  'brouillon',
  'a_controler',
  'valide',
  'comptabilise',
  'rembourse',
] as const;
export type StatutIk = (typeof STATUTS_IK)[number];

export const gestionIkVehicules = pgTable(
  'gestion_ik_vehicules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    libelle: text('libelle').notNull(),
    // Catégorie du barème (voiture, deux-roues…) et puissance fiscale : à renseigner par Marc.
    categorie: text('categorie').notNull(),
    puissanceFiscale: integer('puissance_fiscale'),
    archiveeAt: timestamp('archivee_at', { withTimezone: true }),
  },
  () => [instanceIsolation('gestion_ik_vehicules')],
);

// Barème versionné par année et catégorie. Il ne sert au calcul qu'une fois validé (`valideLe`).
export const gestionIkBaremes = pgTable(
  'gestion_ik_baremes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    annee: integer('annee').notNull(),
    categorie: text('categorie').notNull(),
    version: integer('version').notNull(),
    tranches: jsonb('tranches')
      .$type<
        {
          deKm: number;
          jusquaKm: number | null;
          tauxDixMilliemes: number;
          forfaitCents: number;
        }[]
      >()
      .notNull(),
    // D'où vient le barème (texte officiel, fichier du comptable) : jamais un taux sans source.
    source: text('source').notNull(),
    valideLe: date('valide_le', { mode: 'string' }),
  },
  (t) => [
    uniqueIndex('gestion_ik_baremes_version_idx').on(t.instanceId, t.annee, t.categorie, t.version),
    instanceIsolation('gestion_ik_baremes'),
  ],
);

// Lieux habituels (bureau d'un client…) : distance aller-retour conventionnelle.
export const gestionIkLieux = pgTable(
  'gestion_ik_lieux',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    nom: text('nom').notNull(),
    distanceKm: integer('distance_km').notNull(),
    origine: text('origine', { enum: ORIGINES_DISTANCE }).notNull().default('saisie'),
    archiveeAt: timestamp('archivee_at', { withTimezone: true }),
  },
  () => [instanceIsolation('gestion_ik_lieux')],
);

// « Abonnement de transport » du mois : demandé à Marc, jamais deviné (absence de ligne = inconnu).
export const gestionIkMois = pgTable(
  'gestion_ik_mois',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    mois: text('mois').notNull(),
    abonnement: boolean('abonnement').notNull(),
  },
  (t) => [
    uniqueIndex('gestion_ik_mois_idx').on(t.instanceId, t.mois),
    instanceIsolation('gestion_ik_mois'),
  ],
);

export const gestionIkTrajets = pgTable(
  'gestion_ik_trajets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    vehiculeId: uuid('vehicule_id')
      .notNull()
      .references(() => gestionIkVehicules.id),
    date: date('date', { mode: 'string' }).notNull(),
    trajet: text('trajet').notNull(),
    // Client, projet ou réunion : motif professionnel.
    commentaire: text('commentaire').notNull(),
    kmAllerRetour: integer('km_aller_retour').notNull(),
    origineDistance: text('origine_distance', { enum: ORIGINES_DISTANCE })
      .notNull()
      .default('saisie'),
    mandat: text('mandat'),
    justificatif: text('justificatif'),
    statut: text('statut', { enum: STATUTS_IK }).notNull().default('brouillon'),
    archiveeAt: timestamp('archivee_at', { withTimezone: true }),
  },
  (t) => [
    index('gestion_ik_trajets_idx').on(t.instanceId, t.date),
    instanceIsolation('gestion_ik_trajets'),
  ],
);

// Compte courant d'associé : seuls les mouvements `comptabilise` composent le solde confirmé ; les
// `prevu` restent des estimations. `refSource` rend un mouvement dérivé (IK d'un mois) idempotent.
export const TYPES_CCA = [
  'ouverture',
  'apport',
  'depense_personnelle',
  'ik',
  'loyer',
  'remboursement',
  'correction',
] as const;
export const ETATS_CCA = ['prevu', 'comptabilise'] as const;
export type TypeCca = (typeof TYPES_CCA)[number];

export const gestionCcaMouvements = pgTable(
  'gestion_cca_mouvements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    date: date('date', { mode: 'string' }).notNull(),
    type: text('type', { enum: TYPES_CCA }).notNull(),
    libelle: text('libelle').notNull(),
    // Positif = crédit du compte d'associé (la société doit à l'associé) ; négatif = débit.
    montantCents: integer('montant_cents').notNull(),
    etat: text('etat', { enum: ETATS_CCA }).notNull().default('prevu'),
    // Source du chiffre (relevé, écriture du comptable) : obligatoire pour comptabiliser.
    source: text('source'),
    refSource: text('ref_source'),
    archiveeAt: timestamp('archivee_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('gestion_cca_ref_idx').on(t.instanceId, t.refSource),
    instanceIsolation('gestion_cca_mouvements'),
  ],
);
