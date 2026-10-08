import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { contacts, entreprises } from './schema.js';

const likePattern = (q: string) => `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// Isolation until S3 adds Row-Level Security: every query filters on the instance explicitly.
export async function searchEntreprises(db: Database, instanceId: string, q = '') {
  const p = likePattern(q);
  return db
    .select({
      id: entreprises.id,
      nom: entreprises.nom,
      secteur: entreprises.secteur,
      ville: entreprises.ville,
      taille: entreprises.taille,
      domaine: entreprises.domaine,
      nbContacts: sql<number>`count(${contacts.id})::int`,
    })
    .from(entreprises)
    .leftJoin(
      contacts,
      and(eq(contacts.entrepriseId, entreprises.id), eq(contacts.instanceId, instanceId)),
    )
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
    .groupBy(entreprises.id)
    .orderBy(asc(entreprises.nom));
}

export async function searchContacts(db: Database, instanceId: string, q = '') {
  const p = likePattern(q);
  return db
    .select({
      id: contacts.id,
      nom: contacts.nom,
      fonction: contacts.fonction,
      email: contacts.email,
      role: contacts.role,
      entreprise: entreprises.nom,
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
    .orderBy(asc(contacts.nom));
}
