import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Per user, not per instance: favourites follow Marc from one mandate to the next.
export const preferences = pgTable('preferences', {
  utilisateur: text('utilisateur').primaryKey(),
  favoris: text('favoris').array().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
