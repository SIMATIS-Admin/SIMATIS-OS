import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { connexions } from '../connexions/schema.js';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import type { Instance } from '../instances/schema.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import { logEvent } from '../journal/service.js';
import { contacts, entreprises, opportunites, taches } from './schema.js';

const likePattern = (q: string) => `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// Raised when the instance's CRM must receive the new record but cannot (yet): HTTP 409.
export class CrmIndisponible extends Error {}

// Drizzle writes a bare "id" in single-table queries, which a subquery would resolve to its own
// table: the outer column is named explicitly.
const outerId = sql.raw('"entreprises"."id"');

// Row-Level Security does the isolation; the explicit instance filters are a second safety net.
export async function searchEntreprises(db: Executor, instanceId: string, q = '') {
  const p = likePattern(q);
  return withInstance(db, instanceId, (tx) =>
    tx
      .select({
        id: entreprises.id,
        nom: entreprises.nom,
        secteur: entreprises.secteur,
        ville: entreprises.ville,
        taille: entreprises.taille,
        domaine: entreprises.domaine,
        nbContacts: sql<number>`(select count(*) from ${contacts} c
          where c.entreprise_id = ${outerId} and c.instance_id = ${currentInstance})::int`,
        oppsOuvertes: sql<number>`(select count(*) from ${opportunites} o
          where o.entreprise_id = ${outerId} and o.instance_id = ${currentInstance}
          and o.clos is null)::int`,
        montantOuvert: sql<number>`(select coalesce(sum(o.montant), 0) from ${opportunites} o
          where o.entreprise_id = ${outerId} and o.instance_id = ${currentInstance}
          and o.clos is null)::int`,
      })
      .from(entreprises)
      .where(
        and(
          eq(entreprises.instanceId, instanceId),
          q.trim()
            ? or(
                ilike(entreprises.nom, p),
                ilike(entreprises.secteur, p),
                ilike(entreprises.ville, p),
              )
            : undefined,
        ),
      )
      .orderBy(asc(entreprises.nom)),
  );
}

export async function searchContacts(db: Executor, instanceId: string, q = '') {
  const p = likePattern(q);
  return withInstance(db, instanceId, (tx) =>
    tx
      .select({
        id: contacts.id,
        nom: contacts.nom,
        fonction: contacts.fonction,
        email: contacts.email,
        role: contacts.role,
        entreprise: entreprises.nom,
        entrepriseId: entreprises.id,
      })
      .from(contacts)
      .leftJoin(
        entreprises,
        and(eq(entreprises.id, contacts.entrepriseId), eq(entreprises.instanceId, instanceId)),
      )
      .where(
        and(
          eq(contacts.instanceId, instanceId),
          q.trim()
            ? or(
                ilike(contacts.nom, p),
                ilike(contacts.fonction, p),
                ilike(contacts.email, p),
                ilike(entreprises.nom, p),
              )
            : undefined,
        ),
      )
      .orderBy(asc(contacts.nom)),
  );
}

const oppColumns = {
  id: opportunites.id,
  titre: opportunites.titre,
  etape: opportunites.etape,
  montant: opportunites.montant,
  echeance: opportunites.echeance,
  clos: opportunites.clos,
  motif: opportunites.motif,
  entrepriseId: opportunites.entrepriseId,
  contactId: opportunites.contactId,
};

// Company sheet with its links; null if it does not belong to the instance.
export async function getEntreprise(db: Executor, instanceId: string, id: string) {
  return withInstance(db, instanceId, async (tx) => {
    const [entreprise] = await tx
      .select()
      .from(entreprises)
      .where(and(eq(entreprises.instanceId, currentInstance), eq(entreprises.id, id)));
    if (!entreprise) return null;
    const liees = await tx
      .select({
        id: contacts.id,
        nom: contacts.nom,
        fonction: contacts.fonction,
        email: contacts.email,
        role: contacts.role,
      })
      .from(contacts)
      .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.entrepriseId, id)))
      .orderBy(asc(contacts.nom));
    const opps = await tx
      .select(oppColumns)
      .from(opportunites)
      .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.entrepriseId, id)))
      .orderBy(desc(opportunites.createdAt));
    return { ...entreprise, contacts: liees, opportunites: opps };
  });
}

export async function getContact(db: Executor, instanceId: string, id: string) {
  return withInstance(db, instanceId, async (tx) => {
    const [contact] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, id)));
    if (!contact) return null;
    const [entreprise] = contact.entrepriseId
      ? await tx
          .select({ id: entreprises.id, nom: entreprises.nom })
          .from(entreprises)
          .where(
            and(
              eq(entreprises.instanceId, currentInstance),
              eq(entreprises.id, contact.entrepriseId),
            ),
          )
      : [];
    const opps = await tx
      .select(oppColumns)
      .from(opportunites)
      .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.contactId, id)));
    const ouvertes = await tx
      .select({
        id: taches.id,
        titre: taches.titre,
        canal: taches.canal,
        echeance: taches.echeance,
      })
      .from(taches)
      .where(
        and(
          eq(taches.instanceId, currentInstance),
          eq(taches.contactId, id),
          isNull(taches.faitAt),
        ),
      )
      .orderBy(asc(taches.echeance));
    return { ...contact, entreprise: entreprise ?? null, opportunites: opps, taches: ouvertes };
  });
}

type CreationDeps = ConnexionDeps;

// Simulated creation: real writes are off, nothing was created anywhere.
export type Simulation = { simulation: true; message: string };

// Where a new record goes: the OS itself (no CRM, or fictive data), or the instance's CRM first,
// and then its copy. Returns the HubSpot id, or a Simulation when real writes are off.
async function createInCrm(
  tx: Tx,
  instance: Instance,
  op: 'company.create' | 'contact.create',
  data: Record<string, unknown>,
  deps: CreationDeps,
): Promise<{ sourceId: string } | Simulation | null> {
  const [crm] = await tx
    .select({ fournisseur: connexions.fournisseur, reglages: connexions.reglages })
    .from(connexions)
    .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
  if (!crm || crm.fournisseur === 'fake' || crm.fournisseur === 'natif') return null;
  // A CRM without an explicit direction is read-only, the safe default.
  if ((crm.reglages.sens ?? 'lecture') === 'lecture') {
    throw new CrmIndisponible(
      'CRM en lecture seule : créez la fiche dans le CRM, elle arrivera à la prochaine synchronisation.',
    );
  }
  let result;
  try {
    result = await writeVia(tx, instance, 'crm', { op, data }, deps);
  } catch (error) {
    throw new CrmIndisponible(
      `Création refusée par le CRM : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.simulation) {
    return {
      simulation: true,
      message:
        "Simulation : la fiche aurait été créée dans le CRM du client. Les écritures réelles sont désactivées, rien n'a été créé.",
    };
  }
  if (typeof result.id !== 'string')
    throw new CrmIndisponible('Le CRM n’a pas renvoyé d’identifiant');
  return { sourceId: result.id };
}

export async function createEntreprise(
  db: Executor,
  instance: Instance,
  input: {
    nom: string;
    secteur?: string | null;
    ville?: string | null;
    taille?: number | null;
    domaine?: string | null;
  },
  deps: CreationDeps,
) {
  return withInstance(db, instance.id, async (tx) => {
    const crm = await createInCrm(tx, instance, 'company.create', input, deps);
    if (crm && 'simulation' in crm) return crm;
    const [row] = await tx
      .insert(entreprises)
      .values({
        instanceId: currentInstance,
        ...input,
        ...(crm ? { source: 'hubspot', sourceId: crm.sourceId } : {}),
      })
      .returning();
    if (!row) throw new Error('Entreprise non créée');
    await logEvent(tx, { acteur: 'pilote', action: `Entreprise créée : ${row.nom}`, niveau: 'L2' });
    return row;
  });
}

export async function createContact(
  db: Executor,
  instance: Instance,
  input: {
    nom: string;
    fonction?: string | null;
    email?: string | null;
    telephone?: string | null;
    role?: string | null;
    entrepriseId?: string | null;
  },
  deps: CreationDeps,
) {
  return withInstance(db, instance.id, async (tx) => {
    if (input.entrepriseId) {
      const [owner] = await tx
        .select({ id: entreprises.id })
        .from(entreprises)
        .where(
          and(eq(entreprises.instanceId, currentInstance), eq(entreprises.id, input.entrepriseId)),
        );
      if (!owner) throw new Error('Entreprise inconnue dans cette instance');
    }
    const crm = await createInCrm(tx, instance, 'contact.create', input, deps);
    if (crm && 'simulation' in crm) return crm;
    const [row] = await tx
      .insert(contacts)
      .values({
        instanceId: currentInstance,
        ...input,
        ...(crm ? { source: 'hubspot', sourceId: crm.sourceId } : {}),
      })
      .returning();
    if (!row) throw new Error('Contact non créé');
    await logEvent(tx, { acteur: 'pilote', action: `Contact créé : ${row.nom}`, niveau: 'L2' });
    return row;
  });
}
