import { and, eq, inArray } from 'drizzle-orm';
import { connexions } from '../../connexions/schema.js';
import type { SyncCtx, SyncReport } from '../../connexions/types.js';
import { remplacerLiensHubspot } from '../../crm/liens.js';
import {
  activites,
  contactEmails,
  contacts,
  entreprises,
  opportunites,
  taches,
} from '../../crm/schema.js';
import { SOURCE_CRM_OS } from '../../crm/source.js';
import type { Tx } from '../../db.js';
import { currentInstance } from '../../db/columns.js';
import { logEvent } from '../../journal/service.js';
import type { FicheCrmOs, CrmOsClient } from './client.js';
import {
  liste,
  mapActivite,
  mapAffaire,
  mapContact,
  mapEntreprise,
  mapTache,
  premier,
} from './mapping.js';
import { parseReglages } from './reglages.js';

const SOURCE = SOURCE_CRM_OS;
// Overlap with the previous pass: a record modified during it is read again rather than missed.
const MARGE_MS = 5 * 60_000;

type MirrorTable =
  typeof entreprises | typeof contacts | typeof opportunites | typeof taches | typeof activites;

// Local id of each record already copied, by its id in the compatible CRM.
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

// Updates the copy, or creates it (with `creation` too); never deletes.
async function upsert(
  tx: Tx,
  table: MirrorTable,
  existing: Map<string, string>,
  sourceId: string,
  values: Record<string, unknown>,
  creation: Record<string, unknown>,
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
      .values({
        instanceId: currentInstance,
        source: SOURCE,
        sourceId,
        ...creation,
        ...values,
      } as never)
      .returning({ id: table.id });
    if (row) existing.set(sourceId, row.id);
    report.crees += 1;
  }
}

// Links of each copied record as local ids, the first one being the primary.
function liensDe(
  lus: { sourceId: string; cibles: string[] }[],
  existing: Map<string, string>,
  local: (sourceId: string) => string | null,
) {
  const out = new Map<string, { cibles: string[]; principal: string | null }>();
  for (const { sourceId, cibles } of lus) {
    const owner = existing.get(sourceId);
    if (!owner) continue;
    const ids = [...new Set(cibles.map(local).filter((c): c is string => c !== null))];
    out.set(owner, { cibles: ids, principal: ids[0] ?? null });
  }
  return out;
}

export async function syncCrmOs(ctx: SyncCtx, client: CrmOsClient): Promise<SyncReport> {
  const reglages = parseReglages(ctx.reglages);
  const since = ctx.derniereSynchro ? new Date(ctx.derniereSynchro.getTime() - MARGE_MS) : null;
  const report: SyncReport = { lus: 0, crees: 0, maj: 0, erreurs: [] };
  const suit = (o: (typeof reglages.objets)[number]) => reglages.objets.includes(o);
  const ignore = (objet: string, f: FicheCrmOs) =>
    report.erreurs.push(`${objet} ${f.id} ignoré : champs obligatoires absents`);

  const tx = ctx.tx;
  const idsEntreprises = new Map<string, string>();
  const idsContacts = new Map<string, string>();
  const idsAffaires = new Map<string, string>();
  const resoudre = async (table: MirrorTable, cache: Map<string, string>, ids: string[]) => {
    const manquants = [...new Set(ids.filter((i) => !cache.has(i)))];
    for (const [k, v] of await localIds(tx, table, manquants)) cache.set(k, v);
    return (sourceId: string) => cache.get(sourceId) ?? null;
  };

  // Stages first: the pipeline screen shows them, and deals refer to them.
  if (suit('affaires')) {
    const etapes = (await client.etapes()).map((e) => ({
      id: e.id,
      label: e.label,
      ordre: e.ordre,
      clos: e.clos,
      gagne: e.gagne,
      probabilite: e.probabilite,
    }));
    await tx
      .update(connexions)
      .set({ reglages: { ...ctx.reglages, etapes } })
      .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.id, ctx.connexionId)));
  }

  if (suit('entreprises')) {
    const lues = await client.fiches('entreprise', since);
    report.lus += lues.length;
    const existing = await localIds(
      tx,
      entreprises,
      lues.map((f) => f.id),
    );
    for (const f of lues) {
      const values = mapEntreprise(f);
      if (!values) ignore('Entreprise', f);
      else await upsert(tx, entreprises, existing, f.id, values, {}, report);
    }
    for (const [k, v] of existing) idsEntreprises.set(k, v);
  }

  if (suit('contacts')) {
    const lues = await client.fiches('contact', since);
    report.lus += lues.length;
    const existing = await localIds(
      tx,
      contacts,
      lues.map((f) => f.id),
    );
    const entreprise = await resoudre(
      entreprises,
      idsEntreprises,
      lues.flatMap((f) => liste(f.liens.entreprises)),
    );
    const valides: { f: FicheCrmOs; emails: string[] }[] = [];
    for (const f of lues) {
      const m = mapContact(f);
      if (!m) {
        ignore('Contact', f);
        continue;
      }
      valides.push({ f, emails: m.emails });
      await upsert(
        tx,
        contacts,
        existing,
        f.id,
        { ...m.values, entrepriseId: entreprise(premier(f.liens.entreprises) ?? '') },
        {},
        report,
      );
    }
    for (const [k, v] of existing) idsContacts.set(k, v);
    // The other addresses of a contact (the primary one is kept by the contacts table itself).
    for (const { f, emails } of valides) {
      const id = existing.get(f.id);
      for (const email of emails.slice(1)) {
        if (id) {
          await tx
            .insert(contactEmails)
            .values({ instanceId: currentInstance, contactId: id, email, source: SOURCE })
            .onConflictDoNothing();
        }
      }
    }
    await remplacerLiensHubspot(
      tx,
      'contact',
      'entreprise',
      liensDe(
        valides.map(({ f }) => ({ sourceId: f.id, cibles: liste(f.liens.entreprises) })),
        existing,
        entreprise,
      ),
      SOURCE,
    );
  }

  if (suit('affaires')) {
    const lues = await client.fiches('affaire', since);
    report.lus += lues.length;
    const existing = await localIds(
      tx,
      opportunites,
      lues.map((f) => f.id),
    );
    const entreprise = await resoudre(
      entreprises,
      idsEntreprises,
      lues.flatMap((f) => liste(f.liens.entreprises)),
    );
    const contact = await resoudre(
      contacts,
      idsContacts,
      lues.flatMap((f) => liste(f.liens.contacts)),
    );
    const valides: FicheCrmOs[] = [];
    for (const f of lues) {
      const m = mapAffaire(f);
      if (!m) {
        ignore('Affaire', f);
        continue;
      }
      valides.push(f);
      await upsert(
        tx,
        opportunites,
        existing,
        f.id,
        {
          ...m.miroir,
          entrepriseId: entreprise(premier(f.liens.entreprises) ?? ''),
          contactId: contact(premier(f.liens.contacts) ?? ''),
        },
        m.creation,
        report,
      );
    }
    for (const [k, v] of existing) idsAffaires.set(k, v);
    await remplacerLiensHubspot(
      tx,
      'affaire',
      'contact',
      liensDe(
        valides.map((f) => ({ sourceId: f.id, cibles: liste(f.liens.contacts) })),
        existing,
        contact,
      ),
      SOURCE,
    );
    await remplacerLiensHubspot(
      tx,
      'affaire',
      'entreprise',
      liensDe(
        valides.map((f) => ({ sourceId: f.id, cibles: liste(f.liens.entreprises) })),
        existing,
        entreprise,
      ),
      SOURCE,
    );
  }

  if (suit('taches')) {
    const lues = await client.fiches('tache', since);
    report.lus += lues.length;
    const existing = await localIds(
      tx,
      taches,
      lues.map((f) => f.id),
    );
    const contact = await resoudre(
      contacts,
      idsContacts,
      lues.map((f) => premier(f.liens.contact) ?? '').filter(Boolean),
    );
    const entreprise = await resoudre(
      entreprises,
      idsEntreprises,
      lues.map((f) => premier(f.liens.entreprise) ?? '').filter(Boolean),
    );
    const affaire = await resoudre(
      opportunites,
      idsAffaires,
      lues.map((f) => premier(f.liens.affaire) ?? '').filter(Boolean),
    );
    // A type or links chosen in the OS win over those read from the CRM.
    const choix = existing.size
      ? await tx
          .select({
            sourceId: taches.sourceId,
            typeChoisi: taches.typeChoisi,
            lienChoisi: taches.lienChoisi,
            echeanceChoisie: taches.echeanceChoisie,
          })
          .from(taches)
          .where(
            and(eq(taches.instanceId, currentInstance), inArray(taches.id, [...existing.values()])),
          )
      : [];
    const typesChoisis = new Set(choix.filter((c) => c.typeChoisi).map((c) => c.sourceId));
    const liensChoisis = new Set(choix.filter((c) => c.lienChoisi).map((c) => c.sourceId));
    const datesChoisies = new Set(choix.filter((c) => c.echeanceChoisie).map((c) => c.sourceId));
    for (const f of lues) {
      const m = mapTache(f);
      if (!m) {
        ignore('Tâche', f);
        continue;
      }
      const { type, canal, ...tout } = m;
      // Une date décalée dans l'OS (ventilation) l'emporte sur celle du CRM copié.
      const { echeance, ...sansDate } = tout;
      const valeurs = datesChoisies.has(f.id) ? sansDate : { ...sansDate, echeance };
      await upsert(
        tx,
        taches,
        existing,
        f.id,
        {
          ...valeurs,
          ...(typesChoisis.has(f.id) ? {} : { type, canal }),
          ...(liensChoisis.has(f.id)
            ? {}
            : {
                contactId: contact(premier(f.liens.contact) ?? ''),
                entrepriseId: entreprise(premier(f.liens.entreprise) ?? ''),
                opportuniteId: affaire(premier(f.liens.affaire) ?? ''),
              }),
        },
        {},
        report,
      );
    }
  }

  if (suit('activites')) {
    const lues = await client.fiches('activite', since);
    report.lus += lues.length;
    const existing = await localIds(
      tx,
      activites,
      lues.map((f) => f.id),
    );
    const contact = await resoudre(
      contacts,
      idsContacts,
      lues.map((f) => premier(f.liens.contact) ?? '').filter(Boolean),
    );
    const entreprise = await resoudre(
      entreprises,
      idsEntreprises,
      lues.map((f) => premier(f.liens.entreprise) ?? '').filter(Boolean),
    );
    const affaire = await resoudre(
      opportunites,
      idsAffaires,
      lues.map((f) => premier(f.liens.affaire) ?? '').filter(Boolean),
    );
    for (const f of lues) {
      const m = mapActivite(f);
      if (!m) {
        ignore('Activité', f);
        continue;
      }
      await upsert(
        tx,
        activites,
        existing,
        f.id,
        {
          ...m,
          contactId: contact(premier(f.liens.contact) ?? ''),
          entrepriseId: entreprise(premier(f.liens.entreprise) ?? ''),
          opportuniteId: affaire(premier(f.liens.affaire) ?? ''),
        },
        {},
        report,
      );
    }
  }

  // The OS never deletes a copy by itself: records deleted in the compatible CRM are reported.
  const supprimees = await client.suppressions(since);
  if (supprimees.length) {
    await logEvent(tx, {
      acteur: 'os',
      action: `${supprimees.length} fiche(s) supprimée(s) dans le CRM compatible, conservée(s) ici`,
      details: { fiches: supprimees.slice(0, 50) },
    });
  }
  return report;
}
