import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { preferences } from '../preferences/schema.js';
import { ErreurIA, type ClientIA } from './client.js';
import { LotRefuse } from './lot.js';
import { chercherProspects } from './recherche.js';

export type RechercheTache = {
  id: string;
  etat: 'en_cours' | 'terminee' | 'erreur';
  nombre: number;
  debut: string;
  fin?: string;
  contacts?: Awaited<ReturnType<typeof chercherProspects>>;
  erreur?: string;
};
const prefixe = 'recherche-manuelle:';
const travaux = new Map<string, Promise<void>>();
export const attendreRecherche = (id: string) => travaux.get(id) ?? Promise.resolve();

export async function lireRecherche(db: Database, instanceId: string) {
  const [p] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.utilisateur, prefixe + instanceId));
  return p?.options.rechercheManuelle ?? null;
}

export async function interrompreRecherches(db: Database) {
  await db
    .update(preferences)
    .set({
      options: sql`jsonb_set(${preferences.options}, '{rechercheManuelle}', (${preferences.options}->'rechercheManuelle') || ${JSON.stringify({ etat: 'erreur', erreur: 'La recherche a été interrompue par un redémarrage. Vous pouvez la relancer.', fin: new Date().toISOString() })}::jsonb)`,
    })
    .where(
      and(
        sql`${preferences.utilisateur} like ${prefixe + '%'}`,
        sql`${preferences.options}->'rechercheManuelle'->>'etat' = 'en_cours'`,
      ),
    );
}

export async function effacerRecherche(db: Database, instanceId: string, id: string) {
  await db
    .delete(preferences)
    .where(
      and(
        eq(preferences.utilisateur, prefixe + instanceId),
        sql`${preferences.options}->'rechercheManuelle'->>'id' = ${id}`,
        sql`${preferences.options}->'rechercheManuelle'->>'etat' <> 'en_cours'`,
      ),
    );
}

export async function lancerRecherche(
  db: Database,
  client: ClientIA,
  instanceId: string,
  consignes: string,
  nombre: number,
) {
  const tache: RechercheTache = {
    id: randomUUID(),
    etat: 'en_cours',
    nombre,
    debut: new Date().toISOString(),
  };
  const cle = prefixe + instanceId;
  const [prise] = await db
    .insert(preferences)
    .values({ utilisateur: cle, favoris: [], options: { rechercheManuelle: tache } })
    .onConflictDoUpdate({
      target: preferences.utilisateur,
      set: { options: { rechercheManuelle: tache } },
      setWhere: sql`${preferences.options}->'rechercheManuelle'->>'etat' <> 'en_cours'`,
    })
    .returning();
  if (!prise) throw new LotRefuse('Une recherche est déjà en cours.');
  const travail = (async () => {
    let resultat: RechercheTache;
    try {
      const contacts = await chercherProspects(client, consignes, nombre);
      resultat = { ...tache, etat: 'terminee', fin: new Date().toISOString(), contacts };
    } catch (e) {
      resultat = {
        ...tache,
        etat: 'erreur',
        fin: new Date().toISOString(),
        erreur:
          e instanceof ErreurIA ? e.message : 'La recherche a échoué. Vous pouvez la relancer.',
      };
    }
    await db
      .update(preferences)
      .set({ options: { rechercheManuelle: resultat } })
      .where(
        and(
          eq(preferences.utilisateur, cle),
          sql`${preferences.options}->'rechercheManuelle'->>'id' = ${tache.id}`,
        ),
      );
  })();
  travaux.set(tache.id, travail);
  void travail.catch(() => undefined).finally(() => travaux.delete(tache.id));
  return tache;
}
