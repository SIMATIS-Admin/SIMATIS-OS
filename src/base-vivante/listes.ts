import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import { listInstances } from '../instances/service.js';
import { baseListeFiches, baseListes, baseVivante } from './schema.js';

export class ListeIntrouvable extends Error {}
export class ListeRefusee extends Error {}

export type ResumeListe = { id: string; nom: string; mandat: string | null; nombre: number };

const nomValide = (nom: string): string => {
  const n = nom.trim().replace(/\s+/g, ' ');
  if (!n) throw new ListeRefusee('Donnez un nom à la liste.');
  if (n.length > 80) throw new ListeRefusee('Nom trop long (80 caractères au plus).');
  return n;
};

// The mandate that will prospect the list: one of the mandates of the OS, by its name.
async function mandatConnu(
  db: Executor,
  mandat: string | null | undefined,
): Promise<string | null> {
  if (!mandat) return null;
  const connu = (await listInstances(db)).some((i) => i.type === 'mandat' && i.nom === mandat);
  if (!connu) throw new ListeRefusee('Mandat inconnu.');
  return mandat;
}

export async function resumeListes(tx: Tx, instanceId: string): Promise<ResumeListe[]> {
  const lignes = await tx
    .select({
      id: baseListes.id,
      nom: baseListes.nom,
      mandat: baseListes.mandat,
      // Qualified by hand: inside the subquery a bare "id" would be the member's own.
      nombre: sql<number>`(select count(*)::int from base_liste_fiches m where m.liste_id = ${sql.raw('"base_listes"."id"')})`,
    })
    .from(baseListes)
    .where(eq(baseListes.instanceId, instanceId))
    .orderBy(asc(sql`lower(${baseListes.nom})`));
  return lignes;
}

export async function etiquettesUtilisees(tx: Tx, instanceId: string): Promise<string[]> {
  const { rows } = await tx.execute<{ tag: string }>(
    sql`select distinct unnest(tags) as tag from base_vivante where instance_id = ${instanceId} order by 1`,
  );
  return rows.map((r) => r.tag);
}

export async function creerListe(
  db: Executor,
  instanceId: string,
  { nom, mandat }: { nom: string; mandat?: string | null },
): Promise<ResumeListe> {
  const n = nomValide(nom);
  const m = await mandatConnu(db, mandat);
  return withInstance(db, instanceId, async (tx) => {
    const [existe] = await tx
      .select({ id: baseListes.id })
      .from(baseListes)
      .where(
        and(eq(baseListes.instanceId, instanceId), sql`lower(${baseListes.nom}) = lower(${n})`),
      );
    if (existe) throw new ListeRefusee('Une liste porte déjà ce nom.');
    const [l] = await tx.insert(baseListes).values({ instanceId, nom: n, mandat: m }).returning();
    if (!l) throw new Error('Liste non créée');
    return { id: l.id, nom: l.nom, mandat: l.mandat, nombre: 0 };
  });
}

export async function modifierListe(
  db: Executor,
  instanceId: string,
  id: string,
  patch: { nom?: string; mandat?: string | null },
): Promise<void> {
  const valeurs: Partial<typeof baseListes.$inferInsert> = { updatedAt: new Date() };
  if (patch.nom !== undefined) valeurs.nom = nomValide(patch.nom);
  if (patch.mandat !== undefined) valeurs.mandat = await mandatConnu(db, patch.mandat);
  await withInstance(db, instanceId, async (tx) => {
    if (valeurs.nom) {
      const [autre] = await tx
        .select({ id: baseListes.id })
        .from(baseListes)
        .where(
          and(
            eq(baseListes.instanceId, instanceId),
            sql`lower(${baseListes.nom}) = lower(${valeurs.nom})`,
            sql`${baseListes.id} <> ${id}`,
          ),
        );
      if (autre) throw new ListeRefusee('Une liste porte déjà ce nom.');
    }
    const maj = await tx
      .update(baseListes)
      .set(valeurs)
      .where(and(eq(baseListes.id, id), eq(baseListes.instanceId, instanceId)))
      .returning({ id: baseListes.id });
    if (maj.length === 0) throw new ListeIntrouvable('Liste introuvable');
  });
}

// The contacts stay in the base: only the group goes.
export async function supprimerListe(db: Executor, instanceId: string, id: string): Promise<void> {
  await withInstance(db, instanceId, async (tx) => {
    const sup = await tx
      .delete(baseListes)
      .where(and(eq(baseListes.id, id), eq(baseListes.instanceId, instanceId)))
      .returning({ id: baseListes.id });
    if (sup.length === 0) throw new ListeIntrouvable('Liste introuvable');
  });
}

async function listeDe(tx: Tx, instanceId: string, id: string) {
  const [l] = await tx
    .select({ id: baseListes.id })
    .from(baseListes)
    .where(and(eq(baseListes.id, id), eq(baseListes.instanceId, instanceId)));
  if (!l) throw new ListeIntrouvable('Liste introuvable');
}

// Contacts of another instance are ignored, a contact already in the list is not added twice.
export async function ajouterALaListe(
  db: Executor,
  instanceId: string,
  id: string,
  ficheIds: string[],
): Promise<number> {
  return withInstance(db, instanceId, async (tx) => {
    await listeDe(tx, instanceId, id);
    const miens = await tx
      .select({ id: baseVivante.id })
      .from(baseVivante)
      .where(
        and(
          eq(baseVivante.instanceId, instanceId),
          inArray(baseVivante.id, [...new Set(ficheIds)]),
        ),
      );
    if (miens.length === 0) return 0;
    const ajoutees = await tx
      .insert(baseListeFiches)
      .values(miens.map((f) => ({ instanceId, listeId: id, ficheId: f.id })))
      .onConflictDoNothing()
      .returning({ id: baseListeFiches.id });
    return ajoutees.length;
  });
}

export async function retirerDeLaListe(
  db: Executor,
  instanceId: string,
  id: string,
  ficheIds: string[],
): Promise<void> {
  await withInstance(db, instanceId, async (tx) => {
    await listeDe(tx, instanceId, id);
    await tx
      .delete(baseListeFiches)
      .where(
        and(
          eq(baseListeFiches.instanceId, instanceId),
          eq(baseListeFiches.listeId, id),
          inArray(baseListeFiches.ficheId, ficheIds),
        ),
      );
  });
}
