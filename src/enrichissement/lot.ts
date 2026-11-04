import { and, asc, eq, inArray } from 'drizzle-orm';
import { baseVivante } from '../base-vivante/schema.js';
import { withInstance } from '../db/context.js';
import type { Executor } from '../db.js';
import { listInstances } from '../instances/service.js';
import { analyserReponse, consigne, entree, SCHEMA_REPONSE } from './analyse.js';
import { ErreurIA, type ClientIA } from './client.js';
import {
  enrichissementLignes,
  enrichissementSuggestions,
  enrichissementTaches,
  type Ligne,
  type Tache,
  type TypeEnrichissement,
} from './schema.js';

export type ParamsLot = {
  type: TypeEnrichissement;
  profil: string[];
  maxParEntreprise: number;
  ficheIds: string[];
};
export type ReglagesLot = { lotMax: number; budgetJetons: number; parallelisme: number };

export class LotRefuse extends Error {}

type FicheBase = typeof baseVivante.$inferSelect;

// Un lot qui tourne : ce que `attendreLot` rend aux tests, et rien d'autre n'en dépend.
const enCours = new Map<string, Promise<void>>();
export const attendreLot = (tacheId: string): Promise<void> =>
  enCours.get(tacheId) ?? Promise.resolve();

// Pourquoi une fiche n'est pas envoyée à l'IA ; null si elle l'est.
function raisonIgnoree(f: FicheBase, type: TypeEnrichissement): string | null {
  if (f.opposition) return 'Fiche en opposition';
  if (f.exclusion) return `Fiche exclue (${f.exclusion})`;
  const aUnContact = Boolean(f.nom || f.prenom);
  if (type === 'contacts') {
    return aUnContact && (f.email || f.telephone) ? 'Contact déjà complet' : null;
  }
  if (!aUnContact) return 'Aucun contact à compléter';
  return f.email && f.telephone ? 'Rien à compléter' : null;
}

export async function lancerLot(
  db: Executor,
  client: ClientIA,
  reglages: ReglagesLot,
  instanceId: string,
  p: ParamsLot,
): Promise<Tache> {
  const profil = p.profil.map((x) => x.trim()).filter(Boolean);
  const ids = [...new Set(p.ficheIds)];
  if (ids.length === 0) throw new LotRefuse('Aucune fiche sélectionnée');
  if (ids.length > reglages.lotMax)
    throw new LotRefuse(`Un lot est limité à ${reglages.lotMax} fiches`);
  if (p.type === 'contacts' && profil.length === 0)
    throw new LotRefuse('Indiquez au moins une fonction recherchée');

  const tache = await withInstance(db, instanceId, async (tx) => {
    const [actif] = await tx
      .select({ id: enrichissementTaches.id })
      .from(enrichissementTaches)
      .where(
        and(
          eq(enrichissementTaches.instanceId, instanceId),
          eq(enrichissementTaches.etat, 'en_cours'),
        ),
      );
    if (actif) throw new LotRefuse('Un enrichissement est déjà en cours');
    // Une fiche inconnue de l'instance (ou supprimée) n'a pas de ligne : la clé étrangère l'interdit.
    const fiches = await tx
      .select()
      .from(baseVivante)
      .where(and(eq(baseVivante.instanceId, instanceId), inArray(baseVivante.id, ids)));
    if (fiches.length === 0) throw new LotRefuse('Fiches introuvables');
    const [neuve] = await tx
      .insert(enrichissementTaches)
      .values({
        instanceId,
        type: p.type,
        profil,
        maxParEntreprise: p.maxParEntreprise,
        etat: 'en_cours',
      })
      .returning();
    if (!neuve) throw new Error('Tâche non créée');
    const ordre = new Map(ids.map((id, i) => [id, i]));
    await tx.insert(enrichissementLignes).values(
      fiches
        .sort((a, b) => (ordre.get(a.id) ?? 0) - (ordre.get(b.id) ?? 0))
        .map((f) => {
          const raison = raisonIgnoree(f, p.type);
          return {
            instanceId,
            tacheId: neuve.id,
            ficheId: f.id,
            etat: raison ? ('ignoree' as const) : ('attente' as const),
            raison,
          };
        }),
    );
    return neuve;
  });
  demarrer(db, client, reglages, instanceId, tache);
  return tache;
}

function demarrer(
  db: Executor,
  client: ClientIA,
  reglages: ReglagesLot,
  instanceId: string,
  tache: Tache,
): void {
  // Un lot ne doit jamais laisser un rejet sans écouteur (il arrêterait le serveur) ni une tâche
  // « en cours » à jamais (elle bloquerait les lancements suivants).
  const fin = traiter(db, client, reglages, instanceId, tache)
    .catch(() =>
      withInstance(db, instanceId, (tx) =>
        tx
          .update(enrichissementTaches)
          .set({ etat: 'interrompue', erreur: 'Erreur interne', updatedAt: new Date() })
          .where(eq(enrichissementTaches.id, tache.id)),
      ).then(
        () => undefined,
        () => undefined,
      ),
    )
    .finally(() => enCours.delete(tache.id));
  enCours.set(tache.id, fin);
}

async function traiter(
  db: Executor,
  client: ClientIA,
  reglages: ReglagesLot,
  instanceId: string,
  tache: Tache,
): Promise<void> {
  const lignes = await withInstance(db, instanceId, (tx) =>
    tx
      .select()
      .from(enrichissementLignes)
      .where(
        and(eq(enrichissementLignes.tacheId, tache.id), eq(enrichissementLignes.etat, 'attente')),
      )
      .orderBy(asc(enrichissementLignes.createdAt)),
  );
  let jetons = tache.jetons;
  let fatale: string | null = null;
  let suivante = 0;

  const marquer = (l: Ligne, etat: Ligne['etat'], raison: string | null = null) =>
    withInstance(db, instanceId, (tx) =>
      tx
        .update(enrichissementLignes)
        .set({ etat, raison, updatedAt: new Date() })
        .where(eq(enrichissementLignes.id, l.id)),
    );

  const travailler = async (l: Ligne) => {
    if (fatale) return marquer(l, 'ignoree', fatale);
    if (jetons >= reglages.budgetJetons) return marquer(l, 'ignoree', 'Budget du lot atteint');
    await marquer(l, 'en_cours');
    const [fiche] = await withInstance(db, instanceId, (tx) =>
      tx.select().from(baseVivante).where(eq(baseVivante.id, l.ficheId)),
    );
    if (!fiche) return; // supprimée entre-temps : la ligne a disparu avec elle
    try {
      const reponse = await client.demander({
        consigne: consigne(
          fiche.nom ? 'completer' : 'contacts',
          tache.profil.length ? tache.profil : ['Dirigeant'],
          fiche.nom ? 1 : tache.maxParEntreprise,
        ),
        entree: entree({
          entreprise: fiche.entreprise,
          domaine: fiche.domaine,
          prenom: fiche.prenom,
          nom: fiche.nom || null,
          fonction: fiche.fonction,
          email: fiche.email,
          telephone: fiche.telephone,
        }),
        schema: SCHEMA_REPONSE,
      });
      jetons += reponse.jetons;
      const candidats = analyserReponse(reponse.json, tache.maxParEntreprise);
      await withInstance(db, instanceId, async (tx) => {
        if (candidats.length > 0)
          await tx
            .insert(enrichissementSuggestions)
            .values(
              candidats.map((c) => ({ ...c, instanceId, tacheId: tache.id, ficheId: l.ficheId })),
            );
        await tx
          .update(enrichissementTaches)
          .set({ jetons, updatedAt: new Date() })
          .where(eq(enrichissementTaches.id, tache.id));
        await tx
          .update(enrichissementLignes)
          .set({ etat: 'terminee', raison: null, updatedAt: new Date() })
          .where(eq(enrichissementLignes.id, l.id));
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erreur inconnue';
      if (e instanceof ErreurIA && e.fatale) fatale = message;
      await marquer(l, 'echec', message);
    }
  };

  const travailleur = async () => {
    for (;;) {
      const l = lignes[suivante++];
      if (!l) return;
      await travailler(l);
    }
  };
  await Promise.all(Array.from({ length: reglages.parallelisme }, travailleur));

  await withInstance(db, instanceId, (tx) =>
    tx
      .update(enrichissementTaches)
      .set({
        etat: fatale ? 'interrompue' : 'terminee',
        erreur: fatale,
        jetons,
        updatedAt: new Date(),
      })
      .where(eq(enrichissementTaches.id, tache.id)),
  );
}

export async function etatLot(
  db: Executor,
  instanceId: string,
  tacheId: string,
): Promise<{ tache: Tache; lignes: (Ligne & { entreprise: string })[] }> {
  return withInstance(db, instanceId, async (tx) => {
    const [tache] = await tx
      .select()
      .from(enrichissementTaches)
      .where(eq(enrichissementTaches.id, tacheId));
    if (!tache) throw new LotRefuse('Enrichissement introuvable');
    const rows = await tx
      .select({ l: enrichissementLignes, entreprise: baseVivante.entreprise })
      .from(enrichissementLignes)
      .innerJoin(baseVivante, eq(baseVivante.id, enrichissementLignes.ficheId))
      .where(eq(enrichissementLignes.tacheId, tacheId))
      .orderBy(asc(enrichissementLignes.createdAt));
    return { tache, lignes: rows.map(({ l, entreprise }) => ({ ...l, entreprise })) };
  });
}

// Au démarrage : un lot laissé en cours par un arrêt du serveur repart des fiches pas encore traitées.
export async function reprendreLotsInterrompus(
  db: Executor,
  client: ClientIA,
  reglages: ReglagesLot,
): Promise<void> {
  for (const instance of await listInstances(db)) {
    const taches = await withInstance(db, instance.id, async (tx) => {
      const actives = await tx
        .select()
        .from(enrichissementTaches)
        .where(eq(enrichissementTaches.etat, 'en_cours'));
      if (actives.length > 0)
        await tx
          .update(enrichissementLignes)
          .set({ etat: 'attente', updatedAt: new Date() })
          .where(
            and(
              eq(enrichissementLignes.etat, 'en_cours'),
              inArray(
                enrichissementLignes.tacheId,
                actives.map((a) => a.id),
              ),
            ),
          );
      return actives;
    });
    for (const tache of taches)
      if (!enCours.has(tache.id)) demarrer(db, client, reglages, instance.id, tache);
  }
}
