import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { contacts, entreprises } from '../crm/schema.js';
import { vmaTests } from './schema.js';

export class RattachementImpossible extends Error {}

export async function contactsVma(db: Database, instanceId: string) {
  return withInstance(db, instanceId, async (tx) => {
    const tests = await tx
      .select()
      .from(vmaTests)
      .where(eq(vmaTests.instanceId, instanceId))
      .orderBy(desc(vmaTests.createdAt));
    const personnes = await tx.select().from(contacts).where(eq(contacts.instanceId, instanceId));
    const organisations = await tx
      .select()
      .from(entreprises)
      .where(eq(entreprises.instanceId, instanceId));
    return tests.map((test) => ({
      ...test,
      contactLie: personnes.find((c) => c.id === test.contactId) ?? null,
      entrepriseLiee: organisations.find((e) => e.id === test.entrepriseId) ?? null,
    }));
  });
}

// Rattacher l'invitation ne modifie pas les coordonnées ni les associations du CRM.
export async function rattacherContactVma(
  db: Database,
  instanceId: string,
  id: string,
  choix: { contactId?: string | null; entrepriseId?: string | null },
) {
  return withInstance(db, instanceId, async (tx) => {
    const [test] = await tx
      .select()
      .from(vmaTests)
      .where(and(eq(vmaTests.instanceId, instanceId), eq(vmaTests.id, id)))
      .for('update');
    if (!test) throw new RattachementImpossible('Invitation introuvable');
    for (const [table, valeur] of [
      [contacts, choix.contactId],
      [entreprises, choix.entrepriseId],
    ] as const) {
      if (!valeur) continue;
      const [fiche] = await tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.instanceId, instanceId), eq(table.id, valeur)));
      if (!fiche) throw new RattachementImpossible('Fiche introuvable dans cette instance');
    }
    await tx
      .update(vmaTests)
      .set({ ...choix, updatedAt: new Date() })
      .where(and(eq(vmaTests.instanceId, instanceId), eq(vmaTests.id, id)));
  });
}

export async function retirerAccordVma(db: Database, instanceId: string, id: string) {
  return withInstance(db, instanceId, async (tx) => {
    const [test] = await tx
      .update(vmaTests)
      .set({
        consentement: sql`case when ${vmaTests.consentement} is not null then ${vmaTests.consentement} || jsonb_build_object('retireLe', ${new Date().toISOString()}::text) else null end`,
        updatedAt: new Date(),
      })
      .where(and(eq(vmaTests.instanceId, instanceId), eq(vmaTests.id, id)))
      .returning({ id: vmaTests.id });
    if (!test) throw new RattachementImpossible('Invitation introuvable');
  });
}
