import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { rendezVous } from '../crm/schema.js';
import { instanceIsolation, metierColumns } from '../db/columns.js';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const STATUTS_ENREGISTREMENT = ['en_cours', 'clos', 'transcrit', 'erreur'] as const;
export type StatutEnregistrement = (typeof STATUTS_ENREGISTREMENT)[number];
export const PISTES = ['moi', 'autres'] as const;
export type Piste = (typeof PISTES)[number];

// Une session d'enregistrement d'une visio, rattachée à son rendez-vous.
export const enregistrementsVisio = pgTable(
  'enregistrements_visio',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    rendezVousId: uuid('rendez_vous_id')
      .notNull()
      .references(() => rendezVous.id, { onDelete: 'cascade' }),
    statut: text('statut', { enum: STATUTS_ENREGISTREMENT }).notNull().default('en_cours'),
    debutAt: timestamp('debut_at', { withTimezone: true }).notNull().defaultNow(),
    finAt: timestamp('fin_at', { withTimezone: true }),
    // Dernier signe de vie de la capture : une session muette trop longtemps est close d'office.
    dernierMorceauAt: timestamp('dernier_morceau_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    transcript: text('transcript'),
    // Résumé rédigé par Claude à partir du transcript, à relire par Marc.
    resume: text('resume'),
    resumeAt: timestamp('resume_at', { withTimezone: true }),
  },
  (t) => [
    index('enregistrements_visio_rdv_idx').on(t.rendezVousId),
    instanceIsolation('enregistrements_visio'),
  ],
);

// Un fichier audio autonome d'environ 30 s d'une piste. Le son est supprimé une fois transcrit.
export const morceauxVisio = pgTable(
  'morceaux_visio',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    enregistrementId: uuid('enregistrement_id')
      .notNull()
      .references(() => enregistrementsVisio.id, { onDelete: 'cascade' }),
    piste: text('piste', { enum: PISTES }).notNull(),
    rang: integer('rang').notNull(),
    debutMs: integer('debut_ms').notNull().default(0),
    mime: text('mime').notNull().default('audio/webm'),
    audio: bytea('audio'),
    texte: text('texte'),
  },
  (t) => [
    uniqueIndex('morceaux_visio_piste_rang_idx').on(t.enregistrementId, t.piste, t.rang),
    instanceIsolation('morceaux_visio'),
  ],
);

export type EnregistrementVisio = typeof enregistrementsVisio.$inferSelect;
export type MorceauVisio = typeof morceauxVisio.$inferSelect;
