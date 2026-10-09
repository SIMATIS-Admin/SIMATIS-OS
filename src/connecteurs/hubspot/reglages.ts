import { z } from 'zod';

export const OBJETS = ['entreprises', 'contacts', 'transactions', 'taches'] as const;

// Fields the pilot can exclude (Paramètres > Connexions): an excluded field is never read from
// HubSpot nor written to it. Names, emails and stages are required for the mirror to work.
export const CHAMPS_EXCLUABLES = [
  { cle: 'phone', libelle: 'Téléphone' },
  { cle: 'jobtitle', libelle: 'Fonction' },
  { cle: 'hubspot_owner_id', libelle: 'Propriétaire' },
  { cle: 'amount', libelle: 'Montant' },
  { cle: 'closedate', libelle: 'Date de clôture' },
  { cle: 'industry', libelle: 'Secteur' },
  { cle: 'city', libelle: 'Ville' },
  { cle: 'numberofemployees', libelle: 'Effectif' },
  { cle: 'annualrevenue', libelle: "Chiffre d'affaires annuel" },
] as const;

export type Etape = { id: string; label: string; ordre: number; clos: boolean; gagne: boolean };

export const reglagesSchema = z.object({
  frequence: z.enum(['5min', '15min', '1h', '1j', 'manuel']).default('15min'),
  // Read-only first: the first full pass is checked by the pilot before writing to the client's CRM.
  sens: z.enum(['deux_sens', 'lecture']).default('lecture'),
  objets: z.array(z.enum(OBJETS)).default([...OBJETS]),
  champsExclus: z
    .array(z.enum(CHAMPS_EXCLUABLES.map((c) => c.cle) as [string, ...string[]]))
    .default(['annualrevenue']),
  // Email domains whose contacts and companies are never mirrored (normalized, see domaines.ts).
  domainesExclus: z.array(z.string()).default([]),
  // Deal stages read from the HubSpot pipelines at each sync (pipeline screen columns).
  etapes: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        ordre: z.number(),
        clos: z.boolean(),
        gagne: z.boolean(),
      }),
    )
    .default([]),
});

export type ReglagesHubspot = z.infer<typeof reglagesSchema>;

export const parseReglages = (raw: unknown): ReglagesHubspot => reglagesSchema.parse(raw ?? {});
