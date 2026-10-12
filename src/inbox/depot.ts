import { and, eq } from 'drizzle-orm';
import { contacts, entreprises } from '../crm/schema.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { sujets, type OrigineSujet, type TypeSujet } from './schema.js';

export type DepotSujet = {
  type: TypeSujet;
  titre: string;
  resume?: string | null;
  origine: OrigineSujet;
  source: string;
  sourceId: string;
  lien?: string | null;
  echeance?: Date | null;
  contactId?: string | null;
  entrepriseId?: string | null;
  propositionId?: string | null;
};

export class SujetInvalide extends Error {}

// Drops a subject in the current instance's Inbox. A key already used creates nothing, whatever
// the status of the existing subject: a checked subject never comes back.
export async function deposerSujet(
  tx: Tx,
  d: DepotSujet,
): Promise<{ statut: 'cree' | 'existant'; id: string }> {
  // Foreign keys alone would accept a contact or company of another instance.
  for (const [table, id, nom] of [
    [contacts, d.contactId, 'Contact'],
    [entreprises, d.entrepriseId, 'Entreprise'],
  ] as const) {
    if (!id) continue;
    const [found] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.instanceId, currentInstance), eq(table.id, id)));
    if (!found) throw new SujetInvalide(`${nom} introuvable dans cette instance`);
  }
  const [cree] = await tx
    .insert(sujets)
    .values({
      instanceId: currentInstance,
      type: d.type,
      titre: d.titre,
      resume: d.resume ?? null,
      origine: d.origine,
      source: d.source,
      sourceId: d.sourceId,
      lien: d.lien ?? null,
      echeance: d.echeance ?? null,
      contactId: d.contactId ?? null,
      entrepriseId: d.entrepriseId ?? null,
      propositionId: d.propositionId ?? null,
    })
    .onConflictDoNothing({ target: [sujets.instanceId, sujets.source, sujets.sourceId] })
    .returning({ id: sujets.id });
  if (cree) return { statut: 'cree', id: cree.id };
  const [existant] = await tx
    .select({ id: sujets.id })
    .from(sujets)
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.source, d.source),
        eq(sujets.sourceId, d.sourceId),
      ),
    );
  if (!existant) throw new Error('Sujet ni créé ni trouvé');
  return { statut: 'existant', id: existant.id };
}
