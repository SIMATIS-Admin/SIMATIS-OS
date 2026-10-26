import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { assurerLiensPrincipaux } from '../crm/liens.js';
import { activites } from '../crm/schema.js';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import { sujets } from '../inbox/schema.js';
import { instances } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { cle, col, lignesOu, lire } from './acces.js';
import { planifierTransfert, type DemandeTransfert } from './plan.js';
import { ACTIVITES_DE, REGISTRE } from './registre.js';
import type { Noeud, Ref, TypeObjet } from './types.js';

export type Resume = { deplaces: number; copies: number; racine: Ref & { instance: string } };
export type DemandeExecution = DemandeTransfert & { copierQuandMeme?: boolean };

// The copy of this object already exists in the target: the pilot opens it or copies anyway.
export class CopieDejaFaite extends Error {
  constructor(readonly noeud: Ref) {
    super('Cet objet a déjà été copié dans cette instance.');
  }
}

const TYPES = Object.keys(REGISTRE) as TypeObjet[];
const NOM_TYPE: Record<TypeObjet, string> = {
  sujet: 'entrée',
  tache: 'tâche',
  affaire: 'affaire',
  contact: 'contact',
  entreprise: 'entreprise',
  rdv: 'rendez-vous',
};
const ACTIVITE_COLONNES = Object.entries(ACTIVITES_DE) as [keyof typeof ACTIVITES_DE, string][];

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
    if (apercu.copieExistante && !p.copierQuandMeme)
      throw new CopieDejaFaite(apercu.copieExistante);

    const [origine] = await tx.select().from(instances).where(eq(instances.id, p.instanceOrigine));
    const [cible] = await tx.select().from(instances).where(eq(instances.id, p.cible));
    if (!origine || !cible) throw new Error('Instance disparue pendant le transfert');

    const deplaces = apercu.noeuds.filter((n) => n.mode === 'deplace');
    const copies = apercu.noeuds.filter((n) => n.mode === 'copie');
    const idsDe = (type: TypeObjet) => deplaces.filter((n) => n.type === type).map((n) => n.id);
    // Where each object of the sub-graph ends up: a moved one keeps its id, a copy gets a new one.
    const destination = new Map<string, string>();
    for (const n of deplaces) destination.set(cle(n), n.id);
    for (const n of copies) destination.set(cle(n), randomUUID());
    const versCible = (type: TypeObjet, id: unknown) =>
      typeof id === 'string' ? (destination.get(`${type}:${id}`) ?? null) : null;

    // 1. Copies first, without links (a link may point at a copy not inserted yet).
    for (const n of copies) {
      const entree = REGISTRE[n.type];
      const ligne = await lire(tx, n.type, origine.id, n.id);
      if (!ligne) continue;
      const neuve: Record<string, unknown> = {
        ...ligne,
        id: destination.get(cle(n)),
        instanceId: cible.id,
        // Detached from the third-party tool: an OS object of its own from now on.
        source: 'natif',
        sourceId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      for (const l of entree.liens) neuve[l.colonne] = null;
      for (const c of entree.coupes) neuve[c] = null;
      // `event_id` is unique per instance and the copy no longer follows the calendar event.
      if (n.type === 'rdv') neuve.eventId = `copie:${destination.get(cle(n))}`;
      await tx.insert(entree.table).values(neuve as never);
    }

    // 2. Links of moved rows and of copies are rewritten to where their target ended up; a link
    // to an object that is not in the sub-graph is cut.
    for (const n of apercu.noeuds) {
      const entree = REGISTRE[n.type];
      const ligne = await lire(tx, n.type, origine.id, n.id);
      if (!ligne) continue;
      const valeurs: Record<string, string | null> = {};
      for (const l of entree.liens) {
        const v = ligne[l.colonne];
        if (typeof v !== 'string') continue;
        const nouveau = versCible(l.vers, v);
        if (nouveau !== v) valeurs[l.colonne] = nouveau;
      }
      if (n.mode === 'deplace') for (const c of entree.coupes) valeurs[c] = null;
      if (Object.keys(valeurs).length) {
        const id = destination.get(cle(n)) as string;
        await maj(tx, entree.table, valeurs, eq(col(entree.table, 'id'), id));
      }
    }

    // 3. A row left behind may not point at a moved row either.
    for (const n of deplaces) {
      for (const u of TYPES) {
        for (const l of REGISTRE[u].liens.filter((x) => x.vers === n.type)) {
          const table = REGISTRE[u].table;
          for (const r of await lignesOu(tx, table, origine.id, l.colonne, n.id)) {
            if (apercu.noeuds.some((x) => x.type === u && x.id === r.id)) continue;
            await maj(tx, table, { [l.colonne]: null }, eq(col(table, 'id'), r.id as string));
          }
        }
      }
    }

    // 4. Many-to-many rows. Between two moved rows the row moves. Once a copy is involved, the
    // row is created again between the destinations; the original goes away if one end left.
    for (const u of TYPES) {
      for (const l of REGISTRE[u].liaisons) {
        const rows = new Map<string, Record<string, unknown>>();
        for (const n of apercu.noeuds) {
          const colonnes = [
            ...(l.proprietaire === n.type ? [l.colProprietaire] : []),
            ...(l.cible === n.type ? [l.colCible] : []),
          ];
          for (const c of colonnes) {
            for (const r of await lignesOu(tx, l.table, origine.id, c, n.id)) {
              rows.set(r.id as string, r);
            }
          }
        }
        for (const r of rows.values()) {
          const proprio = apercu.noeuds.find(
            (n) => n.type === l.proprietaire && n.id === r[l.colProprietaire],
          );
          const autre = apercu.noeuds.find((n) => n.type === l.cible && n.id === r[l.colCible]);
          const unPart = [proprio, autre].some((n) => n?.mode === 'deplace');
          const rid = r.id as string;
          if (proprio && autre) {
            if (proprio.mode === 'deplace' && autre.mode === 'deplace') {
              await maj(tx, l.table, { instanceId: cible.id }, eq(col(l.table, 'id'), rid));
              continue;
            }
            await tx.insert(l.table).values({
              ...r,
              id: randomUUID(),
              instanceId: cible.id,
              [l.colProprietaire]: destination.get(cle(proprio)),
              [l.colCible]: destination.get(cle(autre)),
              createdAt: new Date(),
              updatedAt: new Date(),
            } as never);
          }
          if (unPart) await tx.delete(l.table).where(eq(col(l.table, 'id'), rid));
        }
      }
    }

    // 5. Entries keep one row per key and instance: a taken key is suffixed rather than refused.
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

    // 6. Activities follow the object they are about. A moved object brings its own; an activity
    // about a copied object is copied. Whatever else it points at follows the same destinations.
    const vues = new Set<string>();
    for (const n of [...deplaces, ...copies]) {
      const colonne = ACTIVITES_DE[n.type as keyof typeof ACTIVITES_DE];
      if (!colonne) continue;
      for (const a of await lignesOu(tx, activites, origine.id, colonne, n.id)) {
        const aid = a.id as string;
        if (vues.has(aid)) continue;
        vues.add(aid);
        const refs: Record<string, string | null> = {};
        let suitUnDeplace = false;
        for (const [type, c] of ACTIVITE_COLONNES) {
          refs[c] = versCible(type, a[c]);
          if (typeof a[c] === 'string' && deplaces.some((d) => d.type === type && d.id === a[c])) {
            suitUnDeplace = true;
          }
        }
        if (suitUnDeplace) {
          await maj(tx, activites, { ...refs, instanceId: cible.id }, eq(activites.id, aid));
        } else {
          await tx.insert(activites).values({
            ...a,
            ...refs,
            id: randomUUID(),
            instanceId: cible.id,
            source: 'natif',
            sourceId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as never);
        }
      }
    }

    // 7. The moved rows themselves.
    for (const type of TYPES) {
      const ids = idsDe(type);
      if (!ids.length) continue;
      const table = REGISTRE[type].table;
      await maj(tx, table, { instanceId: cible.id }, inArray(col(table, 'id'), ids));
    }

    // 8. Where the object came from, then primary links.
    const noteOrigine = async (n: Noeud, verbe: string) => {
      const colonne = ACTIVITES_DE[n.type as keyof typeof ACTIVITES_DE];
      if (!colonne) return;
      await tx.insert(activites).values({
        instanceId: cible.id,
        type: 'note',
        titre: `${verbe} depuis l’instance ${origine.nom}`,
        resume: `${NOM_TYPE[n.type]} « ${n.libelle} »`,
        at: new Date(),
        [colonne]: destination.get(cle(n)),
      } as never);
    };
    for (const n of deplaces) await noteOrigine(n, 'Déplacé');
    for (const n of copies) await noteOrigine(n, 'Créé');
    for (const n of apercu.noeuds) {
      if (n.type === 'affaire' || n.type === 'contact') {
        const kind = n.type;
        const id = destination.get(cle(n)) as string;
        await withInstance(tx, cible.id, (itx) => assurerLiensPrincipaux(itx, kind, id));
      }
    }

    // 9. The target's journal remembers each copy: it is what spots a copy made twice.
    if (copies.length) {
      await withInstance(tx, cible.id, (itx) =>
        logEvent(itx, {
          acteur: 'pilote',
          action: 'transfert.copie',
          details: {
            copies: copies.map((n) => ({
              type: n.type,
              origineInstance: origine.id,
              origineId: n.id,
              copieId: destination.get(cle(n)),
            })),
          },
        }),
      );
    }

    return {
      deplaces: deplaces.length,
      copies: copies.length,
      racine: {
        type: p.racine.type,
        id: destination.get(cle(p.racine)) ?? p.racine.id,
        instance: cible.id,
      },
    };
  });
}
