import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import type { Kind } from './fiches.js';
import { rdvAffaires, rdvContacts, rdvEntreprises, rendezVous } from './schema.js';

type Table = PgTable & { instanceId: AnyPgColumn; rendezVousId: AnyPgColumn };
const LIENS: Record<Kind, { table: Table; colonne: AnyPgColumn; cle: string }> = {
  contact: { table: rdvContacts, colonne: rdvContacts.contactId, cle: 'contactId' },
  entreprise: { table: rdvEntreprises, colonne: rdvEntreprises.entrepriseId, cle: 'entrepriseId' },
  affaire: { table: rdvAffaires, colonne: rdvAffaires.opportuniteId, cle: 'opportuniteId' },
};

export type RdvLie = { id: string; titre: string; debut: Date | null; compteRendu: boolean };

// The meetings linked to a record (« Rendez-vous » card of a contact, company or deal), the most
// recent first. A meeting sorted as « pas un RDV » is not shown.
export async function rendezVousDe(tx: Tx, kind: Kind, id: string): Promise<RdvLie[]> {
  const { table, colonne } = LIENS[kind];
  return tx
    .select({
      id: rendezVous.eventId,
      titre: rendezVous.titre,
      debut: rendezVous.debut,
      compteRendu: sql<boolean>`${rendezVous.compteRendu} is not null`,
    })
    .from(table)
    .innerJoin(rendezVous, eq(rendezVous.id, table.rendezVousId))
    .where(
      and(eq(table.instanceId, currentInstance), eq(colonne, id), ne(rendezVous.statut, 'ignore')),
    )
    .orderBy(desc(rendezVous.debut));
}

// Merge: the meetings of the absorbed record move to the kept one; those the kept record already
// has stay as they are (the absorbed record's own rows go with its deletion).
export async function transfererRendezVous(
  tx: Tx,
  kind: Kind,
  absorbeId: string,
  gardeId: string,
): Promise<void> {
  const { table, colonne, cle } = LIENS[kind];
  const deja = tx
    .select({ r: table.rendezVousId })
    .from(table)
    .where(and(eq(table.instanceId, currentInstance), eq(colonne, gardeId)));
  await tx
    .update(table)
    .set({ [cle]: gardeId })
    .where(
      and(
        eq(table.instanceId, currentInstance),
        eq(colonne, absorbeId),
        sql`${table.rendezVousId} not in (${deja})`,
      ),
    );
}
