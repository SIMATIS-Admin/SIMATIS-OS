import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { preferences } from '../preferences/schema.js';
import { ErreurIA, type ClientIA } from './client.js';
import { LotRefuse } from './lot.js';
import { chercherNouveauxProspects, type ProspectRecherche } from './recherche-nouveaux.js';

export type RechercheTache = {
  id: string;
  etat: 'en_cours' | 'terminee' | 'a_completer' | 'erreur';
  nombre: number;
  consignes?: string;
  passage?: number;
  message?: string;
  debut: string;
  fin?: string;
  contacts?: ProspectRecherche[];
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
  const tache = p?.options.rechercheManuelle;
  if (!tache) return null;
  if (tache.etat === 'terminee' && (tache.contacts?.length ?? 0) < tache.nombre)
    return {
      ...tache,
      nombre: tache.nombre,
      etat: 'a_completer' as const,
      message:
        'Cette recherche antérieure n’a pas atteint l’objectif. Vérifiez les critères puis poursuivez pour compléter la liste.',
    };
  return tache;
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
  precedents: NonNullable<RechercheTache['contacts']> = [],
) {
  const tache: RechercheTache = {
    id: randomUUID(),
    etat: 'en_cours',
    nombre,
    consignes,
    contacts: precedents,
    passage: 0,
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
  const enregistrer = async (resultat: RechercheTache) => {
    await db
      .update(preferences)
      .set({ options: { rechercheManuelle: resultat } })
      .where(
        and(
          eq(preferences.utilisateur, cle),
          sql`${preferences.options}->'rechercheManuelle'->>'id' = ${tache.id}`,
        ),
      );
  };
  const travail = (async () => {
    let resultat: RechercheTache;
    try {
      const recherche = await chercherNouveauxProspects(
        db,
        client,
        instanceId,
        consignes,
        tache.nombre,
        precedents,
        async (contacts, passage) => {
          tache.passage = passage;
          tache.contacts = contacts;
          await enregistrer(tache);
        },
      );
      resultat = {
        ...tache,
        etat: 'terminee',
        fin: new Date().toISOString(),
        contacts: recherche.contacts,
        passage: recherche.passage,
        message: undefined,
      };
    } catch (e) {
      resultat = {
        ...tache,
        etat: 'erreur',
        fin: new Date().toISOString(),
        erreur:
          e instanceof ErreurIA ? e.message : 'La recherche a échoué. Vous pouvez la relancer.',
      };
    }
    await enregistrer(resultat);
  })();
  travaux.set(tache.id, travail);
  void travail.catch(() => undefined).finally(() => travaux.delete(tache.id));
  return tache;
}
