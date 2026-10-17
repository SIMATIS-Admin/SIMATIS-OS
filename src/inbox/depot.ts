import { and, eq } from 'drizzle-orm';
import { contacts, entreprises } from '../crm/schema.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import type { Proposition } from '../propositions/schema.js';
import { PRIORITE_DEFAUT, sujets, type OrigineSujet, type TypeSujet } from './schema.js';

export type DepotSujet = {
  type: TypeSujet;
  titre: string;
  resume?: string | null;
  origine: OrigineSujet;
  source: string;
  sourceId: string;
  lien?: string | null;
  echeance?: Date | null;
  priorite?: number;
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
  // The link is opened by a click in the OS: only a web address, never javascript: or data:.
  if (d.lien && !/^https?:\/\//i.test(d.lien)) {
    throw new SujetInvalide('Lien invalide : une adresse web (http ou https) est attendue');
  }
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
      priorite: d.priorite ?? PRIORITE_DEFAUT,
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texte = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

// Short title of a proposal: mail subject, task or note title, quote to send, else its type.
export function titreProposition(p: Pick<Proposition, 'type' | 'contenu'>): string {
  const c = (p.contenu ?? {}) as Record<string, unknown>;
  const numero = texte(c.numero);
  return (
    texte(c.objet) ?? texte(c.titre) ?? (numero ? `Transmettre le devis ${numero}` : null) ?? p.type
  );
}

// A pending proposal waits in the Inbox as an "à valider" subject (key: the proposal id).
export async function sujetPourProposition(tx: Tx, p: Proposition): Promise<void> {
  const cible = (p.contenu as { contactId?: unknown } | null)?.contactId;
  // A contact unknown here only loses the link: the proposal itself must still be created.
  const [contact] =
    typeof cible === 'string' && UUID.test(cible)
      ? await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, cible)))
      : [];
  await deposerSujet(tx, {
    type: 'a_valider',
    titre: titreProposition(p),
    origine: 'os',
    source: 'os',
    sourceId: p.id,
    contactId: contact?.id ?? null,
    propositionId: p.id,
  });
}

// Once the proposal is decided (applied, failed or rejected), its subject is handled.
export async function cloreSujetProposition(
  tx: Tx,
  propositionId: string,
  par: string,
): Promise<void> {
  await tx
    .update(sujets)
    .set({ statut: 'traite', traiteAt: new Date(), traitePar: par, updatedAt: new Date() })
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.propositionId, propositionId),
        eq(sujets.statut, 'a_traiter'),
      ),
    );
}
