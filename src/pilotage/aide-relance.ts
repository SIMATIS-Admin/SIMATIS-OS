import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db.js';
import { preferences } from '../preferences/schema.js';

// Actions de l'aide à la relance que Marc a reportées ou écartées : clé de l'action → instant (ms)
// jusqu'auquel elle reste cachée. Rangées côté serveur pour survivre à un changement de navigateur ;
// par instance, comme la file elle-même.
export type Masquees = Record<string, number>;
const prefixe = 'aide-relance:';
// « Pas pertinent » : l'écart est définitif (la plus grande date d'un instant JavaScript).
export const MAX_MASQUE = 8.64e15;

export const schemaMasque = z
  .object({ id: z.string().min(1).max(300), jusqua: z.number().int().min(0).max(MAX_MASQUE) })
  .strict();

// Seules les actions encore cachées sont renvoyées : une date passée ne sert plus à rien.
export async function lireMasquees(
  db: Database,
  instanceId: string,
  maintenant = Date.now(),
): Promise<Masquees> {
  const [p] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.utilisateur, prefixe + instanceId));
  return Object.fromEntries(
    Object.entries(p?.options.aideRelance ?? {}).filter(([, jusqua]) => jusqua > maintenant),
  );
}

// Plusieurs actions d'un coup (nettoyage des tâches périmées) : une seule écriture.
export const schemaMasqueLot = z
  .object({
    ids: z.array(z.string().min(1).max(300)).min(1).max(2000),
    jusqua: z.number().int().min(0).max(MAX_MASQUE),
  })
  .strict();

export async function masquerAction(
  db: Database,
  instanceId: string,
  id: string,
  jusqua: number,
  maintenant = Date.now(),
): Promise<Masquees> {
  return masquerActions(db, instanceId, [id], jusqua, maintenant);
}

export async function masquerActions(
  db: Database,
  instanceId: string,
  ids: string[],
  jusqua: number,
  maintenant = Date.now(),
): Promise<Masquees> {
  const suivantes = {
    ...(await lireMasquees(db, instanceId, maintenant)),
    ...Object.fromEntries(ids.map((id) => [id, jusqua])),
  };
  await db
    .insert(preferences)
    .values({
      utilisateur: prefixe + instanceId,
      favoris: [],
      options: { aideRelance: suivantes },
    })
    .onConflictDoUpdate({
      target: preferences.utilisateur,
      set: {
        options: sql`jsonb_set(${preferences.options}, '{aideRelance}', ${JSON.stringify(suivantes)}::jsonb)`,
      },
    });
  return suivantes;
}
