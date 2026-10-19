import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { activiteValide } from './activites.js';
import { diagnosticProjets } from './schema.js';
import { DiagnosticIndisponible } from './service.js';

// Format d'un fichier d'import (produit en privé, jamais versé dans le dépôt).
export const importSchema = z.object({
  projets: z.array(
    z.object({
      nom: z.string().trim().min(1).max(200),
      activite: z.string().refine(activiteValide, 'Activité inconnue'),
      contexte: z.string().max(5000).optional(),
      etape: z.number().int().min(1).max(3),
      dims: z
        .object({
          outils: z.number().min(0).max(10),
          strategie: z.number().min(0).max(10),
          polyvalence: z.number().min(0).max(10),
        })
        .nullable()
        .optional(),
      statutDiagnostic: z.enum(['Rapport à rédiger', 'Restitué']).nullable().optional(),
      dateDiagnostic: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      revue: z.record(z.string(), z.unknown()).nullable().optional(),
      rapport: z
        .object({ nom: z.string().min(1).max(300), base64: z.string().min(1) })
        .nullable()
        .optional(),
    }),
  ),
});
export type ImportEntree = z.infer<typeof importSchema>['projets'][number];

// Importe des projets sans jamais écraser : un projet déjà présent (même nom) est signalé et laissé tel quel.
export async function importerProjets(
  db: Executor,
  instance: Instance,
  projets: ImportEntree[],
): Promise<{ crees: string[]; deja: string[] }> {
  if (instance.type !== 'propre')
    throw new DiagnosticIndisponible("Le diagnostic est réservé à l'espace SIMATIS.");
  return withInstance(db, instance.id, async (tx) => {
    const crees: string[] = [];
    const deja: string[] = [];
    for (const p of projets) {
      const [existant] = await tx
        .select({ id: diagnosticProjets.id })
        .from(diagnosticProjets)
        .where(
          and(eq(diagnosticProjets.instanceId, instance.id), eq(diagnosticProjets.nom, p.nom)),
        );
      if (existant) {
        deja.push(p.nom);
        continue;
      }
      await tx.insert(diagnosticProjets).values({
        instanceId: instance.id,
        nom: p.nom,
        activite: p.activite,
        contexte: p.contexte ?? '',
        etape: p.etape,
        dims: p.dims ?? null,
        statutDiagnostic: p.statutDiagnostic ?? null,
        dateDiagnostic: p.dateDiagnostic ?? null,
        revue: p.revue ?? null,
        rapport: p.rapport?.base64 ?? null,
        rapportNom: p.rapport?.nom ?? null,
      });
      crees.push(p.nom);
    }
    return { crees, deja };
  });
}
