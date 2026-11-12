import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Executor } from '../db.js';
import { preferences } from '../preferences/schema.js';

// La séquence à froid : les jours qui séparent une touche de la suivante. Par défaut J+4, J+9 puis
// J+15 depuis le premier mail, soit 4, 5 puis 6 jours entre deux touches.
export const DELAIS_DEFAUT = [4, 5, 6];

export const schemaSequence = z.object({
  delais: z.array(z.number().int().min(1).max(60)).min(1).max(5),
});
export type SequenceFroid = z.infer<typeof schemaSequence>;

const prefixe = 'sequence-froid:';

export async function lireSequence(db: Executor, instanceId: string): Promise<SequenceFroid> {
  const [p] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.utilisateur, prefixe + instanceId));
  const lue = schemaSequence.safeParse(p?.options.sequence);
  return lue.success ? lue.data : { delais: DELAIS_DEFAUT };
}

export async function sauverSequence(
  db: Database,
  instanceId: string,
  sequence: SequenceFroid,
): Promise<SequenceFroid> {
  const s = schemaSequence.parse(sequence);
  await db
    .insert(preferences)
    .values({ utilisateur: prefixe + instanceId, favoris: [], options: { sequence: s } })
    .onConflictDoUpdate({
      target: preferences.utilisateur,
      set: {
        options: sql`coalesce(${preferences.options}, '{}'::jsonb) || ${JSON.stringify({ sequence: s })}::jsonb`,
      },
    });
  return lireSequence(db, instanceId);
}

// Les délais de l'espace en cours, depuis une transaction déjà placée sur lui.
export async function delaisCourants(tx: Executor): Promise<number[]> {
  const r = await tx.execute<{ id: string | null }>(
    sql`select nullif(current_setting('app.instance_id', true), '') as id`,
  );
  const id = r.rows[0]?.id;
  return id ? (await lireSequence(tx, id)).delais : DELAIS_DEFAUT;
}

// Jours à attendre après la touche numéro `touches` : le dernier délai vaut pour les suivantes.
export const delaiApres = (touches: number, delais: number[]): number =>
  delais[Math.min(Math.max(touches, 1), delais.length) - 1] ?? DELAIS_DEFAUT[0]!;

// « J+4, J+9, J+15 » : les jours depuis le premier mail, pour l'affichage.
export const cumul = (delais: number[]): number[] =>
  delais.reduce<number[]>((acc, d) => [...acc, (acc.at(-1) ?? 0) + d], []);

// La date à partir de laquelle un contact peut recevoir sa prochaine touche, ou null s'il n'en a
// plus à recevoir (plafond atteint) ou n'a encore rien reçu.
export function prochaineTouche(
  suivi: { touches: number; touchesMax: number; derniereLe: Date | null },
  delais: number[],
): Date | null {
  if (suivi.touches < 1 || suivi.touches >= suivi.touchesMax || !suivi.derniereLe) return null;
  return new Date(suivi.derniereLe.getTime() + delaiApres(suivi.touches, delais) * 86_400_000);
}
