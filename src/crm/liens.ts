import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { parseReglages } from '../connecteurs/hubspot/reglages.js';
import { connexions } from '../connexions/schema.js';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import type { Kind, SimulationFiche } from './fiches.js';
import { FicheInvalide } from './fiches.js';
import { CrmIndisponible } from './service.js';
import {
  affaireContacts,
  affaireEntreprises,
  contactEntreprises,
  contacts,
  entreprises,
  opportunites,
} from './schema.js';

export type Ref = { kind: Kind; id: string };
export type LienFiche = {
  id: string;
  nom: string;
  principal: boolean;
  etape?: string;
  clos?: string | null;
  montant?: number | null;
};
export type LiensFiche = { contacts: LienFiche[]; entreprises: LienFiche[]; affaires: LienFiche[] };

const SIMULATION: SimulationFiche = {
  simulation: true,
  message: "Simulation : rien n'a été écrit dans HubSpot (écritures réelles désactivées).",
};

const tables = { affaire: opportunites, contact: contacts, entreprise: entreprises } as const;

// One side of a link owns its primary link: a deal has one primary contact and one primary company,
// a contact one primary company. The primary is mirrored in the single-link column the rest of the
// OS already reads (opportunites.contact_id…).
type Paire = {
  link: PgTable;
  id: AnyPgColumn;
  source: AnyPgColumn;
  ownerKind: 'affaire' | 'contact';
  targetKind: 'contact' | 'entreprise';
  ownerKey: string;
  targetKey: string;
  ownerFk: AnyPgColumn;
  targetFk: AnyPgColumn;
  principal: AnyPgColumn;
  instanceId: AnyPgColumn;
  createdAt: AnyPgColumn;
  // Column of the owner table holding the primary link.
  mirror: string;
};

const PAIRES: Paire[] = [
  {
    link: affaireContacts,
    id: affaireContacts.id,
    source: affaireContacts.source,
    ownerKind: 'affaire',
    targetKind: 'contact',
    ownerKey: 'opportuniteId',
    targetKey: 'contactId',
    ownerFk: affaireContacts.opportuniteId,
    targetFk: affaireContacts.contactId,
    principal: affaireContacts.principal,
    instanceId: affaireContacts.instanceId,
    createdAt: affaireContacts.createdAt,
    mirror: 'contactId',
  },
  {
    link: affaireEntreprises,
    id: affaireEntreprises.id,
    source: affaireEntreprises.source,
    ownerKind: 'affaire',
    targetKind: 'entreprise',
    ownerKey: 'opportuniteId',
    targetKey: 'entrepriseId',
    ownerFk: affaireEntreprises.opportuniteId,
    targetFk: affaireEntreprises.entrepriseId,
    principal: affaireEntreprises.principal,
    instanceId: affaireEntreprises.instanceId,
    createdAt: affaireEntreprises.createdAt,
    mirror: 'entrepriseId',
  },
  {
    link: contactEntreprises,
    id: contactEntreprises.id,
    source: contactEntreprises.source,
    ownerKind: 'contact',
    targetKind: 'entreprise',
    ownerKey: 'contactId',
    targetKey: 'entrepriseId',
    ownerFk: contactEntreprises.contactId,
    targetFk: contactEntreprises.entrepriseId,
    principal: contactEntreprises.principal,
    instanceId: contactEntreprises.instanceId,
    createdAt: contactEntreprises.createdAt,
    mirror: 'entrepriseId',
  },
];

function paireDe(a: Ref, b: Ref) {
  for (const p of PAIRES) {
    if (a.kind === p.ownerKind && b.kind === p.targetKind)
      return { p, ownerId: a.id, targetId: b.id };
    if (b.kind === p.ownerKind && a.kind === p.targetKind)
      return { p, ownerId: b.id, targetId: a.id };
  }
  throw new FicheInvalide('Lien impossible entre ces deux types de fiche');
}

async function ligne(tx: Tx, kind: Kind, id: string) {
  const t = tables[kind];
  const [row] = await tx
    .select({ id: t.id, source: t.source })
    .from(t)
    .where(and(eq(t.instanceId, currentInstance), eq(t.id, id)));
  return row ?? null;
}

async function ecrireHubspot(
  tx: Tx,
  instance: Instance,
  op: 'association.add' | 'association.remove',
  data: Record<string, unknown>,
  deps: ConnexionDeps,
) {
  try {
    return (await writeVia(tx, instance, 'crm', { op, data }, deps)).simulation;
  } catch (error) {
    throw new CrmIndisponible(
      `Refusé par HubSpot : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Both ends must be HubSpot copies of an instance whose CRM is HubSpot: the link is then written to
// HubSpot first. A link with an OS-only record lives in the OS only.
async function viaHubspot(tx: Tx, a: { source: string }, b: { source: string }) {
  if (a.source !== 'hubspot' || b.source !== 'hubspot') return false;
  const [c] = await tx
    .select({ fournisseur: connexions.fournisseur, reglages: connexions.reglages })
    .from(connexions)
    .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
  if (c?.fournisseur !== 'hubspot') return false;
  if (parseReglages(c.reglages).sens !== 'deux_sens') {
    throw new CrmIndisponible(
      'CRM en lecture seule : modifiez les liens dans HubSpot, ils remonteront à la prochaine synchronisation.',
    );
  }
  return true;
}

async function preparer(tx: Tx, a: Ref, b: Ref) {
  const { p, ownerId, targetId } = paireDe(a, b);
  const owner = await ligne(tx, p.ownerKind, ownerId);
  const target = await ligne(tx, p.targetKind, targetId);
  if (!owner || !target) throw new FicheInvalide('Fiche introuvable dans cette instance');
  return { p, ownerId, targetId, owner, target, hubspot: await viaHubspot(tx, owner, target) };
}

const donnees = (p: Paire, ownerId: string, targetId: string) => ({
  de: p.ownerKind,
  deId: ownerId,
  vers: p.targetKind,
  versId: targetId,
});

function lienExistant(tx: Tx, p: Paire, ownerId: string, targetId: string) {
  return tx
    .select({ id: p.id, principal: p.principal })
    .from(p.link)
    .where(and(eq(p.instanceId, currentInstance), eq(p.ownerFk, ownerId), eq(p.targetFk, targetId)))
    .then((rows) => rows[0] ?? null) as Promise<{ id: string; principal: boolean } | null>;
}

// Keeps the single-link column of the owner equal to its primary link.
async function refleterPrincipal(tx: Tx, p: Paire, ownerId: string, principalId: string | null) {
  const t = tables[p.ownerKind];
  await tx
    .update(t)
    .set({ [p.mirror]: principalId, updatedAt: new Date() })
    .where(and(eq(t.instanceId, currentInstance), eq(t.id, ownerId)));
}

export async function lierFiches(
  db: Executor,
  instance: Instance,
  a: Ref,
  b: Ref,
  deps: ConnexionDeps,
): Promise<{ ok: true } | SimulationFiche> {
  return withInstance(db, instance.id, async (tx) => {
    const { p, ownerId, targetId, hubspot } = await preparer(tx, a, b);
    if (await lienExistant(tx, p, ownerId, targetId)) return { ok: true as const };
    if (hubspot) {
      const simulation = await ecrireHubspot(
        tx,
        instance,
        'association.add',
        donnees(p, ownerId, targetId),
        deps,
      );
      if (simulation) return SIMULATION;
    }
    const [dejaPrincipal] = await tx
      .select({ id: p.id })
      .from(p.link)
      .where(and(eq(p.instanceId, currentInstance), eq(p.ownerFk, ownerId), eq(p.principal, true)))
      .limit(1);
    await tx.insert(p.link).values({
      instanceId: currentInstance,
      source: hubspot ? 'hubspot' : 'natif',
      [p.ownerKey]: ownerId,
      [p.targetKey]: targetId,
      principal: !dejaPrincipal,
    } as never);
    if (!dejaPrincipal) await refleterPrincipal(tx, p, ownerId, targetId);
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Lien ajouté entre ${a.kind} et ${b.kind}`,
      niveau: 'L2',
    });
    return { ok: true as const };
  });
}

export async function delierFiches(
  db: Executor,
  instance: Instance,
  a: Ref,
  b: Ref,
  deps: ConnexionDeps,
): Promise<{ ok: true } | SimulationFiche> {
  return withInstance(db, instance.id, async (tx) => {
    const { p, ownerId, targetId, hubspot } = await preparer(tx, a, b);
    const existant = await lienExistant(tx, p, ownerId, targetId);
    if (!existant) return { ok: true as const };
    if (hubspot) {
      const simulation = await ecrireHubspot(
        tx,
        instance,
        'association.remove',
        donnees(p, ownerId, targetId),
        deps,
      );
      if (simulation) return SIMULATION;
    }
    await tx.delete(p.link).where(and(eq(p.instanceId, currentInstance), eq(p.id, existant.id)));
    if (existant.principal) {
      const [suivant] = (await tx
        .select({ id: p.id, cible: p.targetFk })
        .from(p.link)
        .where(and(eq(p.instanceId, currentInstance), eq(p.ownerFk, ownerId)))
        .orderBy(asc(p.createdAt))
        .limit(1)) as { id: string; cible: string }[];
      if (suivant) {
        await tx
          .update(p.link)
          .set({ principal: true })
          .where(and(eq(p.instanceId, currentInstance), eq(p.id, suivant.id)));
      }
      await refleterPrincipal(tx, p, ownerId, suivant?.cible ?? null);
    }
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Lien retiré entre ${a.kind} et ${b.kind}`,
      niveau: 'L2',
    });
    return { ok: true as const };
  });
}

export async function definirPrincipal(
  db: Executor,
  instance: Instance,
  a: Ref,
  b: Ref,
  deps: ConnexionDeps,
): Promise<{ ok: true } | SimulationFiche> {
  return withInstance(db, instance.id, async (tx) => {
    const { p, ownerId, targetId, hubspot } = await preparer(tx, a, b);
    const existant = await lienExistant(tx, p, ownerId, targetId);
    if (!existant) throw new FicheInvalide('Ces deux fiches ne sont pas liées');
    // HubSpot's « default » association is the one it shows first: the closest thing to a primary.
    if (hubspot) {
      const simulation = await ecrireHubspot(
        tx,
        instance,
        'association.add',
        donnees(p, ownerId, targetId),
        deps,
      );
      if (simulation) return SIMULATION;
    }
    await tx
      .update(p.link)
      .set({ principal: false })
      .where(and(eq(p.instanceId, currentInstance), eq(p.ownerFk, ownerId)));
    await tx
      .update(p.link)
      .set({ principal: true })
      .where(and(eq(p.instanceId, currentInstance), eq(p.id, existant.id)));
    await refleterPrincipal(tx, p, ownerId, targetId);
    return { ok: true as const };
  });
}

// All links of a record, primary first.
export async function lireLiens(tx: Tx, kind: Kind, id: string): Promise<LiensFiche> {
  const sortie: LiensFiche = { contacts: [], entreprises: [], affaires: [] };
  if (kind === 'affaire') {
    sortie.contacts = await tx
      .select({ id: contacts.id, nom: contacts.nom, principal: affaireContacts.principal })
      .from(affaireContacts)
      .innerJoin(contacts, eq(contacts.id, affaireContacts.contactId))
      .where(
        and(eq(affaireContacts.instanceId, currentInstance), eq(affaireContacts.opportuniteId, id)),
      )
      .orderBy(desc(affaireContacts.principal), asc(affaireContacts.createdAt));
    sortie.entreprises = await tx
      .select({ id: entreprises.id, nom: entreprises.nom, principal: affaireEntreprises.principal })
      .from(affaireEntreprises)
      .innerJoin(entreprises, eq(entreprises.id, affaireEntreprises.entrepriseId))
      .where(
        and(
          eq(affaireEntreprises.instanceId, currentInstance),
          eq(affaireEntreprises.opportuniteId, id),
        ),
      )
      .orderBy(desc(affaireEntreprises.principal), asc(affaireEntreprises.createdAt));
  } else if (kind === 'contact') {
    sortie.entreprises = await tx
      .select({ id: entreprises.id, nom: entreprises.nom, principal: contactEntreprises.principal })
      .from(contactEntreprises)
      .innerJoin(entreprises, eq(entreprises.id, contactEntreprises.entrepriseId))
      .where(
        and(
          eq(contactEntreprises.instanceId, currentInstance),
          eq(contactEntreprises.contactId, id),
        ),
      )
      .orderBy(desc(contactEntreprises.principal), asc(contactEntreprises.createdAt));
    sortie.affaires = await affairesLiees(tx, eq(affaireContacts.contactId, id), 'contact');
  } else {
    sortie.contacts = await tx
      .select({ id: contacts.id, nom: contacts.nom, principal: contactEntreprises.principal })
      .from(contactEntreprises)
      .innerJoin(contacts, eq(contacts.id, contactEntreprises.contactId))
      .where(
        and(
          eq(contactEntreprises.instanceId, currentInstance),
          eq(contactEntreprises.entrepriseId, id),
        ),
      )
      .orderBy(desc(contactEntreprises.principal), asc(contactEntreprises.createdAt));
    sortie.affaires = await affairesLiees(
      tx,
      eq(affaireEntreprises.entrepriseId, id),
      'entreprise',
    );
  }
  return sortie;
}

async function affairesLiees(
  tx: Tx,
  condition: ReturnType<typeof eq>,
  via: 'contact' | 'entreprise',
): Promise<LienFiche[]> {
  const link = via === 'contact' ? affaireContacts : affaireEntreprises;
  const fk = via === 'contact' ? affaireContacts.opportuniteId : affaireEntreprises.opportuniteId;
  return (
    await tx
      .select({
        id: opportunites.id,
        titre: opportunites.titre,
        principal: link.principal,
        etape: opportunites.etape,
        clos: opportunites.clos,
        montant: opportunites.montant,
      })
      .from(link)
      .innerJoin(opportunites, eq(opportunites.id, fk))
      .where(and(eq(link.instanceId, currentInstance), condition))
      .orderBy(desc(opportunites.createdAt))
  ).map(({ titre, ...r }) => ({ ...r, nom: titre }));
}

// HubSpot's links of a batch of records replace the ones copied from HubSpot; links made in the OS
// only (source « natif ») stay. The primary is HubSpot's one, else the existing one, else the first.
export async function remplacerLiensHubspot(
  tx: Tx,
  ownerKind: 'affaire' | 'contact',
  targetKind: 'contact' | 'entreprise',
  liens: Map<string, { cibles: string[]; principal: string | null }>,
): Promise<void> {
  const p = PAIRES.find((x) => x.ownerKind === ownerKind && x.targetKind === targetKind);
  if (!p || liens.size === 0) return;
  const lignes = (await tx
    .select({
      id: p.id,
      owner: p.ownerFk,
      cible: p.targetFk,
      source: p.source,
      principal: p.principal,
    })
    .from(p.link)
    .where(and(eq(p.instanceId, currentInstance), inArray(p.ownerFk, [...liens.keys()])))
    .orderBy(asc(p.createdAt))) as {
    id: string;
    owner: string;
    cible: string;
    source: string;
    principal: boolean;
  }[];
  for (const [ownerId, { cibles, principal }] of liens) {
    const voulus = [...new Set(cibles)];
    const existants = lignes.filter((l) => l.owner === ownerId);
    const asupprimer = existants.filter((l) => l.source === 'hubspot' && !voulus.includes(l.cible));
    for (const l of asupprimer)
      await tx.delete(p.link).where(and(eq(p.instanceId, currentInstance), eq(p.id, l.id)));
    let restants = existants.filter((l) => !asupprimer.includes(l));
    for (const cible of voulus) {
      const deja = restants.find((l) => l.cible === cible);
      if (!deja) {
        await tx.insert(p.link).values({
          instanceId: currentInstance,
          source: 'hubspot',
          [p.ownerKey]: ownerId,
          [p.targetKey]: cible,
        } as never);
        restants = [
          ...restants,
          { id: '', owner: ownerId, cible, source: 'hubspot', principal: false },
        ];
      } else if (deja.source !== 'hubspot') {
        await tx
          .update(p.link)
          .set({ source: 'hubspot' } as never)
          .where(and(eq(p.instanceId, currentInstance), eq(p.id, deja.id)));
      }
    }
    const hubspotPrincipal = principal && voulus.includes(principal) ? principal : voulus[0];
    const choix =
      hubspotPrincipal ?? restants.find((l) => l.principal)?.cible ?? restants[0]?.cible ?? null;
    await tx
      .update(p.link)
      .set({ principal: false } as never)
      .where(and(eq(p.instanceId, currentInstance), eq(p.ownerFk, ownerId)));
    if (choix)
      await tx
        .update(p.link)
        .set({ principal: true } as never)
        .where(
          and(eq(p.instanceId, currentInstance), eq(p.ownerFk, ownerId), eq(p.targetFk, choix)),
        );
    await refleterPrincipal(tx, p, ownerId, choix);
  }
}
