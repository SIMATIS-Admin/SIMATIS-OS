import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { activiteValide } from './activites.js';
import { diagnosticProjets } from './schema.js';
import { DiagnosticIndisponible } from './service.js';
import { LIEN_ARTIFACT } from './support.js';

// Format d'un fichier d'import (produit en privé, jamais versé dans le dépôt).
export const importSchema = z.object({
  projets: z.array(
    z.object({
      nom: z.string().trim().min(1).max(200),
      activite: z.string().refine(activiteValide, 'Activité inconnue'),
      contexte: z.string().max(5000).optional(),
      etape: z.number().int().min(1).max(5),
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
      // Support d'ouverture déjà archivé dans le second cerveau : son texte final, et son deck
      // quand il en a un propre (les premiers venaient du deck modèle, réécrit depuis).
      support: z
        .object({
          lien: z.string().regex(LIEN_ARTIFACT).optional(),
          finalLe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          diapositives: z
            .array(z.object({ titre: z.string().min(1), texte: z.string(), notes: z.string() }))
            .min(1),
        })
        .optional(),
    }),
  ),
});
export type ImportEntree = z.infer<typeof importSchema>['projets'][number];

const colonnesSupport = (support: ImportEntree['support']) =>
  support
    ? {
        supportLien: support.lien ?? null,
        supportTexte: support.diapositives,
        supportStatut: 'final' as const,
        supportFinalLe: new Date(`${support.finalLe}T12:00:00Z`),
      }
    : {};

// Importe des projets sans jamais écraser : un projet déjà présent (même nom) est signalé et laissé
// tel quel, sauf un support absent du projet, qui est ajouté (« complétés »).
export async function importerProjets(
  db: Executor,
  instance: Instance,
  projets: ImportEntree[],
): Promise<{ crees: string[]; deja: string[]; completes: string[] }> {
  if (instance.type !== 'propre')
    throw new DiagnosticIndisponible("Le diagnostic est réservé à l'espace SIMATIS.");
  return withInstance(db, instance.id, async (tx) => {
    const crees: string[] = [];
    const deja: string[] = [];
    const completes: string[] = [];
    for (const p of projets) {
      const [existant] = await tx
        .select({ id: diagnosticProjets.id, supportTexte: diagnosticProjets.supportTexte })
        .from(diagnosticProjets)
        .where(
          and(eq(diagnosticProjets.instanceId, instance.id), eq(diagnosticProjets.nom, p.nom)),
        );
      if (existant) {
        if (p.support && !existant.supportTexte) {
          await tx
            .update(diagnosticProjets)
            .set({ ...colonnesSupport(p.support), updatedAt: new Date() })
            .where(eq(diagnosticProjets.id, existant.id));
          completes.push(p.nom);
        } else deja.push(p.nom);
        continue;
      }
      await tx.insert(diagnosticProjets).values({
        instanceId: instance.id,
        nom: p.nom,
        activite: p.activite,
        contexte: p.contexte ?? '',
        etape: p.etape,
        etapeMax: p.etape,
        dims: p.dims ?? null,
        statutDiagnostic: p.statutDiagnostic ?? null,
        dateDiagnostic: p.dateDiagnostic ?? null,
        revue: p.revue ?? null,
        rapport: p.rapport?.base64 ?? null,
        rapportNom: p.rapport?.nom ?? null,
        ...colonnesSupport(p.support),
      });
      crees.push(p.nom);
    }
    return { crees, deja, completes };
  });
}
