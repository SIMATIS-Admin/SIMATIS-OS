import type { RechercheTache } from '../enrichissement/recherche-tache.js';
import type { RoutineBrouillons } from '../prospection/quotidienne.js';
import type { RoutineRecherche } from '../enrichissement/routine.js';
import type { RoutineAlerte } from '../base-vivante/alerte-signaux.js';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Per user, not per instance: favourites follow Marc from one mandate to the next.
export const preferences = pgTable('preferences', {
  utilisateur: text('utilisateur').primaryKey(),
  favoris: text('favoris').array().notNull(),
  options: jsonb('options')
    .$type<{
      ensuite?: boolean;
      rechercheManuelle?: RechercheTache;
      rechercheBase?: RoutineRecherche;
      signauxBase?: RoutineAlerte;
      brouillons?: RoutineBrouillons;
    }>()
    .notNull()
    .default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
