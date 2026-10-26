import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { activites } from '../crm/schema.js';
import { assurerLiensPrincipaux } from '../crm/liens.js';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import { instances } from '../instances/schema.js';
import { sujets } from '../inbox/schema.js';
import { cle, col, lignesOu, lire } from './acces.js';
import { planifierTransfert, type DemandeTransfert } from './plan.js';
import { ACTIVITES_DE, REGISTRE } from './registre.js';
import type { Ref, TypeObjet } from './types.js';

export type Resume = { deplaces: number; copies: number; racine: Ref & { instance: string } };
export type DemandeExecution = DemandeTransfert & { copierQuandMeme?: boolean };

const TYPES = Object.keys(REGISTRE) as TypeObjet[];
const NOM_TYPE: Record<TypeObjet, string> = {
  sujet: 'entrée',
  tache: 'tâche',
  affaire: 'affaire',
  contact: 'contact',
  entreprise: 'entreprise',
  rdv: 'rendez-vous',
};

const maj = (tx: Tx, table: PgTable, valeurs: Record<string, unknown>, where: SQL | undefined) =>
  tx
    .update(table)
    .set({ ...valeurs, updatedAt: new Date() })
    .where(where);

export async function executerTransfert(db: Executor, p: DemandeExecution): Promise<Resume> {
  return db.transaction(async (tx) => {
    // Two transfers of the same root wait for each other: the second then finds the root gone.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`transfert:${p.racine.id}`}))`);
    const apercu = await planifierTransfert(tx, p);
    if (apercu.noeuds.some((n) => n.mode === 'copie')) throw new Error('Copie non gérée');

    const [origine] = await tx.select().from(instances).where(eq(instances.id, p.instanceOrigine));
    const [cible] = await tx.select().from(instances).where(eq(instances.id, p.cible));
    if (!origine || !cible) throw new Error('Instance disparue pendant le transfert');

    const dansLeSet = new Set(apercu.noeuds.map(cle));
    const deplaces = apercu.noeuds.filter((n) => n.mode === 'deplace');
    const idsDe = (type: TypeObjet) => deplaces.filter((n) => n.type === type).map((n) => n.id);

    // 1. A moved row may only point at moved rows: the other links are cut.
    for (const n of deplaces) {
      const entree = REGISTRE[n.type];
      const ligne = await lire(tx, n.type, origine.id, n.id);
      if (!ligne) continue;
      const coupes: Record<string, null> = {};
      for (const l of entree.liens) {
        const v = ligne[l.colonne];
        if (typeof v === 'string' && !dansLeSet.has(`${l.vers}:${v}`)) coupes[l.colonne] = null;
      }
      for (const c of entree.coupes) coupes[c] = null;
      if (Object.keys(coupes).length) {
        await maj(tx, entree.table, coupes, eq(col(entree.table, 'id'), n.id));
      }
    }

    // 2. A row left behind may not point at a moved row either.
    for (const n of deplaces) {
      for (const u of TYPES) {
        for (const l of REGISTRE[u].liens.filter((x) => x.vers === n.type)) {
          const table = REGISTRE[u].table;
          for (const r of await lignesOu(tx, table, origine.id, l.colonne, n.id)) {
            if (dansLeSet.has(`${u}:${r.id as string}`)) continue;
            await maj(tx, table, { [l.colonne]: null }, eq(col(table, 'id'), r.id as string));
          }
        }
      }
    }

    // 3. Many-to-many rows: kept (and moved) between two moved rows, dropped otherwise.
    const aDeplacer = new Map<PgTable, string[]>();
    for (const u of TYPES) {
      for (const l of REGISTRE[u].liaisons) {
        const lignes = new Map<string, Record<string, unknown>>();
        for (const n of deplaces) {
          if (l.proprietaire === n.type) {
            for (const r of await lignesOu(tx, l.table, origine.id, l.colProprietaire, n.id)) {
              lignes.set(r.id as string, r);
            }
          }
          if (l.cible === n.type) {
            for (const r of await lignesOu(tx, l.table, origine.id, l.colCible, n.id)) {
              lignes.set(r.id as string, r);
            }
          }
        }
        for (const r of lignes.values()) {
          const proprio = deplaces.some(
            (n) => n.type === l.proprietaire && n.id === r[l.colProprietaire],
          );
          const cibleOk = deplaces.some((n) => n.type === l.cible && n.id === r[l.colCible]);
          if (proprio && cibleOk) {
            aDeplacer.set(l.table, [...(aDeplacer.get(l.table) ?? []), r.id as string]);
          } else {
            await tx.delete(l.table).where(eq(col(l.table, 'id'), r.id as string));
          }
        }
      }
    }
    for (const [table, ids] of aDeplacer) {
      await maj(tx, table, { instanceId: cible.id }, inArray(col(table, 'id'), ids));
    }

    // 4. Entries keep one row per key and instance: a taken key is suffixed rather than refused.
    for (const id of idsDe('sujet')) {
      const s = await lire(tx, 'sujet', origine.id, id);
      if (!s || typeof s.sourceId !== 'string') continue;
      const [pris] = await tx
        .select({ id: sujets.id })
        .from(sujets)
        .where(
          and(
            eq(sujets.instanceId, cible.id),
            eq(sujets.source, s.source),
            eq(sujets.sourceId, s.sourceId),
          ),
        );
      if (pris) {
        await maj(tx, sujets, { sourceId: `${s.sourceId}:transfert-${id}` }, eq(sujets.id, id));
      }
    }

    // 5. Activities follow the object they are about; the other links they carry are cut.
    const vues = new Set<string>();
    for (const [type, colonne] of Object.entries(ACTIVITES_DE) as [
      keyof typeof ACTIVITES_DE,
      string,
    ][]) {
      for (const id of idsDe(type)) {
        for (const a of await lignesOu(tx, activites, origine.id, colonne, id)) {
          const aid = a.id as string;
          if (vues.has(aid)) continue;
          vues.add(aid);
          const coupes: Record<string, null> = {};
          for (const [t, c] of Object.entries(ACTIVITES_DE) as [
            keyof typeof ACTIVITES_DE,
            string,
          ][]) {
            const v = a[c];
            if (typeof v === 'string' && !deplaces.some((n) => n.type === t && n.id === v)) {
              coupes[c] = null;
            }
          }
          await maj(tx, activites, { ...coupes, instanceId: cible.id }, eq(activites.id, aid));
        }
      }
    }

    // 6. The rows themselves.
    for (const type of TYPES) {
      const ids = idsDe(type);
      if (!ids.length) continue;
      const table = REGISTRE[type].table;
      await maj(tx, table, { instanceId: cible.id }, inArray(col(table, 'id'), ids));
    }

    // 7. History of the moved objects, then primary links.
    for (const n of deplaces) {
      const colonne = ACTIVITES_DE[n.type as keyof typeof ACTIVITES_DE];
      if (!colonne) continue;
      await tx.insert(activites).values({
        instanceId: cible.id,
        type: 'note',
        titre: `Déplacé depuis l’instance ${origine.nom}`,
        resume: `${NOM_TYPE[n.type]} « ${n.libelle} »`,
        at: new Date(),
        [colonne]: n.id,
      } as never);
    }
    for (const n of deplaces) {
      if (n.type === 'affaire' || n.type === 'contact') {
        await withInstance(tx, cible.id, (itx) =>
          assurerLiensPrincipaux(itx, n.type as 'affaire' | 'contact', n.id),
        );
      }
    }

    return {
      deplaces: deplaces.length,
      copies: 0,
      racine: { type: p.racine.type, id: p.racine.id, instance: cible.id },
    };
  });
}
