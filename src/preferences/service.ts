import { eq } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { preferences } from './schema.js';

// Mockup default (core.js FAVS_DEFAUT).
export const FAVORIS_DEFAUT = ['pipeline', 'brief', 'prospection'];

export async function getFavoris(db: Executor, utilisateur: string): Promise<string[]> {
  const [row] = await db
    .select({ favoris: preferences.favoris })
    .from(preferences)
    .where(eq(preferences.utilisateur, utilisateur));
  return row?.favoris ?? FAVORIS_DEFAUT;
}

export async function setFavoris(
  db: Executor,
  utilisateur: string,
  favoris: string[],
): Promise<string[]> {
  const unique = [...new Set(favoris)];
  await db
    .insert(preferences)
    .values({ utilisateur, favoris: unique })
    .onConflictDoUpdate({
      target: preferences.utilisateur,
      set: { favoris: unique, updatedAt: new Date() },
    });
  return unique;
}
