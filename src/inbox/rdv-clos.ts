import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { rendezVous } from '../crm/schema.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import type { RendezVousPasse } from './lecture.js';

// Un rendez-vous est clos dans l'OS quand le pilote l'a écarté de l'agenda (« pas un RDV ») ou que
// son compte rendu y est déjà enregistré : l'Inbox ne doit plus jamais demander de le rédiger.
export async function evenementsClos(tx: Tx, eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const lignes = await tx
    .select({ eventId: rendezVous.eventId })
    .from(rendezVous)
    .where(
      and(
        eq(rendezVous.instanceId, currentInstance),
        inArray(rendezVous.eventId, eventIds),
        or(eq(rendezVous.statut, 'ignore'), isNotNull(rendezVous.compteRendu)),
      ),
    );
  return new Set(lignes.map((l) => l.eventId));
}

export async function sansRendezVousClos(
  tx: Tx,
  rdvs: RendezVousPasse[],
): Promise<RendezVousPasse[]> {
  const clos = await evenementsClos(
    tx,
    rdvs.map((r) => r.eventId),
  );
  return rdvs.filter((r) => !clos.has(r.eventId));
}
