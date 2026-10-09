import { and, eq, inArray } from 'drizzle-orm';
import { connexions } from '../../connexions/schema.js';
import type { SyncCtx, SyncReport } from '../../connexions/types.js';
import { activites, contacts, entreprises, opportunites, taches } from '../../crm/schema.js';
import type { Tx } from '../../db.js';
import { currentInstance } from '../../db/columns.js';
import type { HsObject, HubspotClient } from './client.js';
import { domaineExclu } from './domaines.js';
import { mapCompany, mapContact, mapDeal, mapStages, mapTask, proprietes } from './mapping.js';
import { parseReglages } from './reglages.js';

const SOURCE = 'hubspot';
// Overlap with the previous pass: a record modified during it is read again rather than missed.
const MARGE_MS = 5 * 60_000;

type MirrorTable = typeof entreprises | typeof contacts | typeof opportunites | typeof taches;

// Local id of each record already mirrored from HubSpot, by HubSpot id.
async function localIds(tx: Tx, table: MirrorTable, sourceIds: string[]) {
  const map = new Map<string, string>();
  if (sourceIds.length === 0) return map;
  const rows = await tx
    .select({ id: table.id, sourceId: table.sourceId })
    .from(table)
    .where(
      and(
        eq(table.instanceId, currentInstance),
        eq(table.source, SOURCE),
        inArray(table.sourceId, sourceIds),
      ),
    );
  for (const r of rows) if (r.sourceId) map.set(r.sourceId, r.id);
  return map;
}

// Updates the copy, or creates it; never deletes (HubSpot is the reference, the OS a copy).
async function upsert(
  tx: Tx,
  table: MirrorTable,
  existing: Map<string, string>,
  sourceId: string,
  values: Record<string, unknown>,
  report: SyncReport,
) {
  const id = existing.get(sourceId);
  if (id) {
    await tx
      .update(table)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(table.instanceId, currentInstance), eq(table.id, id)));
    report.maj += 1;
  } else {
    const [row] = await tx
      .insert(table)
      .values({ instanceId: currentInstance, source: SOURCE, sourceId, ...values } as never)
      .returning({ id: table.id });
    if (row) existing.set(sourceId, row.id);
    report.crees += 1;
  }
}

export async function syncHubspot(ctx: SyncCtx, client: HubspotClient): Promise<SyncReport> {
  const reglages = parseReglages(ctx.reglages);
  const exclus = reglages.champsExclus;
  const domaines = reglages.domainesExclus;
  const since = ctx.derniereSynchro ? new Date(ctx.derniereSynchro.getTime() - MARGE_MS) : null;
  const read = (type: 'companies' | 'contacts' | 'deals' | 'tasks') =>
    since
      ? client.modifiedSince(type, since, proprietes(type, exclus))
      : client.listAll(type, proprietes(type, exclus));
  const report: SyncReport = { lus: 0, crees: 0, maj: 0, erreurs: [] };
  const suit = (o: (typeof reglages.objets)[number]) => reglages.objets.includes(o);

  const companyIds = new Map<string, string>();
  if (suit('entreprises')) {
    const lues = await read('companies');
    const companies = lues.filter((c) => !domaineExclu(c.properties.domain, domaines));
    await retirerSources(
      ctx.tx,
      entreprises,
      lues.filter((c) => !companies.includes(c)),
    );
    report.lus += companies.length;
    const existing = await localIds(
      ctx.tx,
      entreprises,
      companies.map((c) => c.id),
    );
    for (const c of companies) {
      await upsert(ctx.tx, entreprises, existing, c.id, mapCompany(c), report);
    }
    for (const [k, v] of existing) companyIds.set(k, v);
  }

  const resolve = async (
    table: MirrorTable,
    cache: Map<string, string>,
    ids: (string | null)[],
  ) => {
    const missing = [...new Set(ids.filter((i): i is string => !!i && !cache.has(i)))];
    for (const [k, v] of await localIds(ctx.tx, table, missing)) cache.set(k, v);
    return (sourceId: string | null) => (sourceId ? (cache.get(sourceId) ?? null) : null);
  };

  const contactIds = new Map<string, string>();
  if (suit('contacts')) {
    const lus = await read('contacts');
    const list = lus.filter((c) => !domaineExclu(c.properties.email, domaines));
    await retirerSources(
      ctx.tx,
      contacts,
      lus.filter((c) => !list.includes(c)),
    );
    report.lus += list.length;
    const existing = await localIds(
      ctx.tx,
      contacts,
      list.map((c) => c.id),
    );
    const company = await resolve(
      entreprises,
      companyIds,
      list.map((c) => c.properties.associatedcompanyid ?? null),
    );
    for (const c of list) {
      const { entrepriseSourceId, ...values } = mapContact(c);
      await upsert(
        ctx.tx,
        contacts,
        existing,
        c.id,
        { ...values, entrepriseId: company(entrepriseSourceId) },
        report,
      );
    }
    for (const [k, v] of existing) contactIds.set(k, v);
  }

  const dealIds = new Map<string, string>();
  if (suit('transactions')) {
    const etapes = mapStages(await client.dealPipelines());
    await ctx.tx
      .update(connexions)
      .set({ reglages: { ...ctx.reglages, etapes } })
      .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.id, ctx.connexionId)));
    const deals = await read('deals');
    report.lus += deals.length;
    const ids = deals.map((d) => d.id);
    const toCompany = await client.firstAssociations('deals', 'companies', ids);
    const toContact = await client.firstAssociations('deals', 'contacts', ids);
    const existing = await localIds(ctx.tx, opportunites, ids);
    const company = await resolve(entreprises, companyIds, [...toCompany.values()]);
    const contact = await resolve(contacts, contactIds, [...toContact.values()]);
    for (const d of deals) {
      await upsert(
        ctx.tx,
        opportunites,
        existing,
        d.id,
        {
          ...mapDeal(d, etapes),
          entrepriseId: company(toCompany.get(d.id) ?? null),
          contactId: contact(toContact.get(d.id) ?? null),
        },
        report,
      );
    }
    for (const [k, v] of existing) dealIds.set(k, v);
  }

  if (suit('taches')) {
    const tasks: HsObject[] = await read('tasks');
    report.lus += tasks.length;
    const ids = tasks.map((t) => t.id);
    const toContact = await client.firstAssociations('tasks', 'contacts', ids);
    const toDeal = await client.firstAssociations('tasks', 'deals', ids);
    const existing = await localIds(ctx.tx, taches, ids);
    const contact = await resolve(contacts, contactIds, [...toContact.values()]);
    const deal = await resolve(opportunites, dealIds, [...toDeal.values()]);
    for (const t of tasks) {
      await upsert(
        ctx.tx,
        taches,
        existing,
        t.id,
        {
          ...mapTask(t),
          contactId: contact(toContact.get(t.id) ?? null),
          opportuniteId: deal(toDeal.get(t.id) ?? null),
        },
        report,
      );
    }
  }
  return report;
}

// Removes copies (HubSpot is untouched). Deals, tasks and activities linked to them are kept,
// without the link.
async function retirer(tx: Tx, contactIds: string[], entrepriseIds: string[]) {
  if (contactIds.length > 0) {
    for (const table of [opportunites, taches, activites]) {
      await tx
        .update(table)
        .set({ contactId: null })
        .where(and(eq(table.instanceId, currentInstance), inArray(table.contactId, contactIds)));
    }
    await tx
      .delete(contacts)
      .where(and(eq(contacts.instanceId, currentInstance), inArray(contacts.id, contactIds)));
  }
  if (entrepriseIds.length > 0) {
    for (const table of [opportunites, contacts]) {
      await tx
        .update(table)
        .set({ entrepriseId: null })
        .where(
          and(eq(table.instanceId, currentInstance), inArray(table.entrepriseId, entrepriseIds)),
        );
    }
    await tx
      .delete(entreprises)
      .where(
        and(eq(entreprises.instanceId, currentInstance), inArray(entreprises.id, entrepriseIds)),
      );
  }
}

// Records read from HubSpot but excluded: a copy made before (email changed since) goes away.
async function retirerSources(
  tx: Tx,
  table: typeof contacts | typeof entreprises,
  exclues: HsObject[],
) {
  const ids = [
    ...(
      await localIds(
        tx,
        table,
        exclues.map((o) => o.id),
      )
    ).values(),
  ];
  await (table === contacts ? retirer(tx, ids, []) : retirer(tx, [], ids));
}

// Removes the mirrored contacts and companies of excluded domains. Returns the number removed.
export async function retirerDomainesExclus(tx: Tx, domaines: string[]): Promise<number> {
  if (domaines.length === 0) return 0;
  const mine = (table: typeof contacts | typeof entreprises) =>
    and(eq(table.instanceId, currentInstance), eq(table.source, SOURCE));
  const contactIds = (
    await tx.select({ id: contacts.id, email: contacts.email }).from(contacts).where(mine(contacts))
  )
    .filter((c) => domaineExclu(c.email, domaines))
    .map((c) => c.id);
  const entrepriseIds = (
    await tx
      .select({ id: entreprises.id, domaine: entreprises.domaine })
      .from(entreprises)
      .where(mine(entreprises))
  )
    .filter((e) => domaineExclu(e.domaine, domaines))
    .map((e) => e.id);
  await retirer(tx, contactIds, entrepriseIds);
  return contactIds.length + entrepriseIds.length;
}
