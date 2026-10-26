import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { FicheInvalide } from './fiches.js';
import { contactEmails, contacts } from './schema.js';

// Addresses of a contact. contacts.email stays the primary one: a trigger keeps the matching
// contact_emails row primary whatever wrote the column, and the functions below move the primary
// by writing contacts.email.
export type EmailContact = { email: string; principal: boolean };

// HubSpot owns the primary address of its contacts: the next sync would put it back.
const PRINCIPALE_HUBSPOT = 'L’adresse principale d’un contact HubSpot se change dans HubSpot.';
const VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normaliserEmail = (email: string) => email.trim().toLowerCase();

async function existe(tx: Tx, contactId: string) {
  const [c] = await tx
    .select({ id: contacts.id, source: contacts.source })
    .from(contacts)
    .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, contactId)));
  return c ?? null;
}

export async function emailsDuContact(tx: Tx, contactId: string): Promise<EmailContact[]> {
  return tx
    .select({ email: contactEmails.email, principal: contactEmails.principal })
    .from(contactEmails)
    .where(
      and(eq(contactEmails.instanceId, currentInstance), eq(contactEmails.contactId, contactId)),
    )
    .orderBy(
      sql`${contactEmails.principal} desc`,
      asc(contactEmails.createdAt),
      asc(contactEmails.email),
    );
}

// Ids of the contacts having one of these addresses, primary or not (lowercased by the caller or not).
export async function contactsParEmails(tx: Tx, emails: string[]): Promise<Map<string, string>> {
  const liste = [...new Set(emails.map(normaliserEmail).filter(Boolean))];
  if (liste.length === 0) return new Map();
  const rows = await tx
    .select({ email: contactEmails.email, contactId: contactEmails.contactId })
    .from(contactEmails)
    .where(and(eq(contactEmails.instanceId, currentInstance), inArray(contactEmails.email, liste)))
    .orderBy(asc(contactEmails.createdAt));
  const trouves = new Map<string, string>();
  for (const r of rows) if (!trouves.has(r.email)) trouves.set(r.email, r.contactId);
  return trouves;
}

// Adds a secondary address; the first address of a contact becomes its primary.
export async function ajouterEmail(
  db: Executor,
  instance: Instance,
  contactId: string,
  brut: string,
): Promise<EmailContact[] | null> {
  const email = normaliserEmail(brut);
  if (!VALIDE.test(email)) throw new FicheInvalide('Adresse email invalide');
  return withInstance(db, instance.id, async (tx) => {
    const c = await existe(tx, contactId);
    if (!c) return null;
    const actuelles = await emailsDuContact(tx, contactId);
    if (actuelles.length === 0 && c.source === 'hubspot')
      throw new FicheInvalide(PRINCIPALE_HUBSPOT);
    if (actuelles.some((a) => a.email === email))
      throw new FicheInvalide('Ce contact a déjà cette adresse');
    if (actuelles.length === 0) {
      await tx
        .update(contacts)
        .set({ email, updatedAt: new Date() })
        .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, contactId)));
    } else {
      await tx.insert(contactEmails).values({ instanceId: currentInstance, contactId, email });
    }
    await logEvent(tx, { acteur: 'pilote', action: 'Adresse email ajoutée', niveau: 'L2' });
    return emailsDuContact(tx, contactId);
  });
}

async function ecrirePrincipale(tx: Tx, contactId: string, email: string | null) {
  await tx
    .update(contacts)
    .set({ email, updatedAt: new Date() })
    .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, contactId)));
}

export async function definirEmailPrincipal(
  db: Executor,
  instance: Instance,
  contactId: string,
  brut: string,
): Promise<EmailContact[] | null> {
  const email = normaliserEmail(brut);
  return withInstance(db, instance.id, async (tx) => {
    const c = await existe(tx, contactId);
    if (!c) return null;
    if (c.source === 'hubspot') throw new FicheInvalide(PRINCIPALE_HUBSPOT);
    if (!(await emailsDuContact(tx, contactId)).some((a) => a.email === email))
      throw new FicheInvalide('Adresse inconnue pour ce contact');
    await ecrirePrincipale(tx, contactId, email);
    await logEvent(tx, {
      acteur: 'pilote',
      action: 'Adresse email principale changée',
      niveau: 'L2',
    });
    return emailsDuContact(tx, contactId);
  });
}

// Removing the primary address promotes the oldest remaining one; removing the last empties the contact's email.
export async function retirerEmail(
  db: Executor,
  instance: Instance,
  contactId: string,
  brut: string,
): Promise<EmailContact[] | null> {
  const email = normaliserEmail(brut);
  return withInstance(db, instance.id, async (tx) => {
    const c = await existe(tx, contactId);
    if (!c) return null;
    const actuelles = await emailsDuContact(tx, contactId);
    const cible = actuelles.find((a) => a.email === email);
    if (!cible) throw new FicheInvalide('Adresse inconnue pour ce contact');
    if (cible.principal && c.source === 'hubspot') throw new FicheInvalide(PRINCIPALE_HUBSPOT);
    await tx
      .delete(contactEmails)
      .where(
        and(
          eq(contactEmails.instanceId, currentInstance),
          eq(contactEmails.contactId, contactId),
          eq(contactEmails.email, email),
        ),
      );
    if (cible.principal) {
      const suivante = actuelles.find((a) => a.email !== email);
      await ecrirePrincipale(tx, contactId, suivante?.email ?? null);
    }
    await logEvent(tx, { acteur: 'pilote', action: 'Adresse email retirée', niveau: 'L2' });
    return emailsDuContact(tx, contactId);
  });
}
