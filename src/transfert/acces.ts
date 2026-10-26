import { and, eq, getTableColumns } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Executor } from '../db.js';
import { REGISTRE } from './registre.js';
import type { TypeObjet } from './types.js';

export type Ligne = Record<string, unknown> & { id: string; instanceId: string; source: string };

// Registry tables are picked by name, so columns are looked up by Drizzle property name.
export const col = (table: PgTable, nom: string) => getTableColumns(table)[nom] as AnyPgColumn;

// Always filtered on the instance: the owner connection used by transfers bypasses Row-Level Security.
export async function lignesOu(
  db: Executor,
  table: PgTable,
  instanceId: string,
  colonne: string,
  valeur: string,
): Promise<Record<string, unknown>[]> {
  return db
    .select()
    .from(table)
    .where(and(eq(col(table, 'instanceId'), instanceId), eq(col(table, colonne), valeur)));
}

export async function lire(
  db: Executor,
  type: TypeObjet,
  instanceId: string,
  id: string,
): Promise<Ligne | null> {
  const [ligne] = await lignesOu(db, REGISTRE[type].table, instanceId, 'id', id);
  return (ligne as Ligne | undefined) ?? null;
}

export const libelleDe = (type: TypeObjet, ligne: Ligne) => REGISTRE[type].libelle(ligne);
export const cle = (r: { type: TypeObjet; id: string }) => `${r.type}:${r.id}`;
