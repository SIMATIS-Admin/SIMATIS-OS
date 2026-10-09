import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { contacts, entreprises } from '../crm/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { autonomieDef } from '../propositions/autonomie.js';
import { getPropositionType } from '../propositions/registry.js';
import { propositions } from '../propositions/schema.js';
import { decide } from '../propositions/service.js';
import './types-propositions.js';

export type Filtre = 'tout' | 'brouillon' | 'tache' | 'cerveau' | 'traites';

const TYPES: Record<Exclude<Filtre, 'tout' | 'traites'>, string> = {
  brouillon: 'email.brouillon',
  tache: 'crm.tache',
  cerveau: 'note.second_cerveau',
};

// Autonomy action label of a proposal type, or null for a type no longer registered.
function actionLibelle(type: string): string | null {
  try {
    return autonomieDef(getPropositionType(type).action).libelle;
  } catch {
    return null;
  }
}

// The "À valider" queue: pending proposals of the instance (or decided ones with "traites"),
// with the contact they concern and the autonomy level that sent them here.
export async function listPropositions(db: Executor, instance: Instance, filtre: Filtre) {
  return withInstance(db, instance.id, async (tx) => {
    const rows = await tx
      .select()
      .from(propositions)
      .where(
        and(
          eq(propositions.instanceId, currentInstance),
          filtre === 'traites'
            ? ne(propositions.statut, 'proposee')
            : eq(propositions.statut, 'proposee'),
          filtre in TYPES ? eq(propositions.type, TYPES[filtre as keyof typeof TYPES]) : undefined,
        ),
      )
      .orderBy(desc(propositions.createdAt))
      .limit(100);
    const ids = rows
      .map((r) => (r.contenu as { contactId?: string | null }).contactId)
      .filter((id): id is string => typeof id === 'string');
    const liees = ids.length
      ? await tx
          .select({ id: contacts.id, nom: contacts.nom, entreprise: entreprises.nom })
          .from(contacts)
          .leftJoin(
            entreprises,
            and(
              eq(entreprises.id, contacts.entrepriseId),
              eq(entreprises.instanceId, currentInstance),
            ),
          )
          .where(and(eq(contacts.instanceId, currentInstance), inArray(contacts.id, ids)))
      : [];
    return rows.map((r) => {
      const contactId = (r.contenu as { contactId?: string | null }).contactId;
      return {
        ...r,
        action: actionLibelle(r.type),
        contact: liees.find((c) => c.id === contactId) ?? null,
      };
    });
  });
}

export async function deciderProposition(
  db: Executor,
  instance: Instance,
  id: string,
  decision: { decision: 'valider' | 'ecarter'; contenu?: unknown },
  deps: { secretsDir: string; realWrites: boolean },
) {
  return withInstance(db, instance.id, (tx) =>
    decide(tx, { instance, realWrites: deps.realWrites, secretsDir: deps.secretsDir }, id, {
      ...decision,
      par: 'pilote',
    }),
  );
}
