import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { preferences } from '../preferences/schema.js';
import { ErreurIA, type ClientIA } from './client.js';
import { LotRefuse } from './lot.js';
import { chercherProspects } from './recherche.js';

export type RechercheTache = {
  id: string;
  etat: 'en_cours' | 'terminee' | 'a_completer' | 'erreur';
  nombre: number;
  consignes?: string;
  passage?: number;
  message?: string;
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
  const tache = p?.options.rechercheManuelle;
  if (!tache) return null;
  if (tache.etat === 'terminee' && (tache.contacts?.length ?? 0) < Math.max(10, tache.nombre))
    return {
      ...tache,
      nombre: Math.max(10, tache.nombre),
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
    nombre: Math.max(10, nombre),
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
      const contacts = [...precedents];
      const identite = (c: (typeof contacts)[number]) =>
        [c.entreprise, c.prenom, c.nom]
          .join('|')
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase()
          .replace(/\s+/g, '');
      const vus = new Set(contacts.map(identite));
      for (
        let passage = 1;
        contacts.length < tache.nombre && passage <= Math.ceil(tache.nombre / 3) + 5;
        passage++
      ) {
        tache.passage = passage;
        tache.contacts = [...contacts];
        await enregistrer(tache);
        const exclusions = contacts.map((c) => `${c.prenom} ${c.nom} (${c.entreprise})`).join('; ');
        const nouveaux = await chercherProspects(
          client,
          `${consignes}\nNe propose pas à nouveau ces personnes déjà retenues : ${exclusions || 'aucune'}. Cherche d’autres entreprises respectant les mêmes critères, sans inventer de coordonnées.`,
          Math.min(3, tache.nombre - contacts.length),
        );
        const avant = contacts.length;
        for (const c of nouveaux) {
          if (vus.has(identite(c))) continue;
          vus.add(identite(c));
          contacts.push(c);
        }
        tache.contacts = [...contacts];
        await enregistrer(tache);
        if (contacts.length === avant) break;
      }
      const complet = contacts.length >= tache.nombre;
      resultat = {
        ...tache,
        etat: complet ? 'terminee' : 'a_completer',
        fin: new Date().toISOString(),
        contacts,
        message: complet
          ? undefined
          : 'L’objectif n’est pas encore atteint. Les contacts vérifiés sont conservés ; vous pouvez poursuivre la recherche avec les mêmes critères.',
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
