import { and, eq, isNull } from 'drizzle-orm';
import { opportunites, type Qualification } from '../crm/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { FUNNEL_DEFAUT, funnelSchema, simulerFunnel, type Funnel } from './funnel.js';

// Qualification grid out of 15 (five criteria scored 1 to 3); 12 and above is a hot deal.
const SEUIL_CHAUDE = 12;
const score = (q: Qualification | null) =>
  q ? q.besoin + q.decideur + q.budget + q.timing + q.engagement : 0;

export const funnelOf = (instance: Instance): Funnel => {
  const parsed = funnelSchema.safeParse(instance.config.funnel);
  return parsed.success ? parsed.data : FUNNEL_DEFAUT;
};

export async function getTableau(db: Executor, instance: Instance) {
  const ouvertes = await withInstance(db, instance.id, (tx) =>
    tx
      .select({ montant: opportunites.montant, qualification: opportunites.qualification })
      .from(opportunites)
      .where(and(eq(opportunites.instanceId, currentInstance), isNull(opportunites.clos))),
  );
  const somme = (rows: typeof ouvertes) => rows.reduce((a, o) => a + (o.montant ?? 0), 0);
  const chaudes = ouvertes.filter((o) => score(o.qualification) >= SEUIL_CHAUDE);
  const funnel = funnelOf(instance);
  return {
    pipeline: { montant: somme(ouvertes), nombre: ouvertes.length },
    chaudes: { montant: somme(chaudes), nombre: chaudes.length },
    // Campaigns arrive with the prospecting lot (M4).
    derniereCampagne: null,
    funnel,
    simulation: simulerFunnel(funnel),
  };
}
