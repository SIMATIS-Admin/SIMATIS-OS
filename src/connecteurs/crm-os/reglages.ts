import { z } from 'zod';
import type { Etape } from '../hubspot/reglages.js';

export const OBJETS = ['entreprises', 'contacts', 'affaires', 'taches', 'activites'] as const;

// Settings of the `crm-os` connection. Read-only for now: the OS copies the compatible CRM and never
// writes to it (the OS edits would be undone by the next sync anyway).
export const reglagesSchema = z.object({
  frequence: z.enum(['5min', '15min', '1h', '3h', '1j', 'manuel']).default('3h'),
  sens: z.literal('lecture').default('lecture'),
  objets: z.array(z.enum(OBJETS)).default([...OBJETS]),
  // Pipeline stages, read from the compatible CRM at each sync (pipeline screen columns).
  etapes: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        ordre: z.number(),
        clos: z.boolean(),
        gagne: z.boolean(),
        probabilite: z.number().nullable().optional(),
      }),
    )
    .default([]),
});

export type ReglagesCrmOs = z.infer<typeof reglagesSchema>;
export type { Etape };

export const parseReglages = (raw: unknown): ReglagesCrmOs => reglagesSchema.parse(raw ?? {});
