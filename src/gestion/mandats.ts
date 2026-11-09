import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { gestionMandatReglages } from './schema.js';

export const delaiMandatSchema = z.object({
  delaiPaiementJours: z.number().int().min(0).max(365).nullable(),
});

export async function lireDelaisMandats(tx: Executor): Promise<Map<string, number | null>> {
  const lignes = await tx
    .select()
    .from(gestionMandatReglages)
    .where(eq(gestionMandatReglages.instanceId, currentInstance));
  return new Map(lignes.map((l) => [l.mandat, l.delaiPaiementJours]));
}

export async function ecrireDelaiMandat(
  tx: Executor,
  instanceId: string,
  mandat: string,
  delaiPaiementJours: number | null,
): Promise<void> {
  await tx
    .insert(gestionMandatReglages)
    .values({ instanceId, mandat, delaiPaiementJours })
    .onConflictDoUpdate({
      target: [gestionMandatReglages.instanceId, gestionMandatReglages.mandat],
      set: { delaiPaiementJours, updatedAt: new Date() },
    });
}
