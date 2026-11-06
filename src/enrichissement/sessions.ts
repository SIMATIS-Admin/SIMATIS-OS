import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { enrichissementLignes, enrichissementTaches, rechercheSessions } from './schema.js';

export type SessionEnrichissement = {
  id: string;
  date: string;
  // « recherche » : nouveaux prospects ; « enrichissement » : compléter ou trouver des contacts sur des fiches existantes.
  nature: 'recherche' | 'enrichissement';
  libelle: string;
  mode: 'manuel' | 'automatique';
  etat: 'en_cours' | 'terminee' | 'incomplete' | 'erreur';
  // Fiches ou contacts traités / obtenus, selon la nature.
  traites: number;
  ajoutees: number | null;
  detail: string | null;
};

export async function ouvrirSessionRecherche(
  db: Database,
  instanceId: string,
  p: { id?: string; mode: 'manuel' | 'automatique'; nombreVise: number },
) {
  const [ligne] = await withInstance(db, instanceId, (tx) =>
    tx
      .insert(rechercheSessions)
      .values({ ...(p.id ? { id: p.id } : {}), instanceId, mode: p.mode, nombreVise: p.nombreVise })
      .returning({ id: rechercheSessions.id }),
  );
  return ligne!.id;
}

export async function cloreSessionRecherche(
  db: Database,
  instanceId: string,
  id: string,
  fin: {
    etat: 'terminee' | 'incomplete' | 'erreur';
    trouves: number;
    ajoutees?: number;
    rapprochees?: number;
    erreur?: string;
  },
) {
  await withInstance(db, instanceId, (tx) =>
    tx
      .update(rechercheSessions)
      .set({
        etat: fin.etat,
        trouves: fin.trouves,
        ajoutees: fin.ajoutees ?? null,
        rapprochees: fin.rapprochees ?? null,
        erreur: fin.erreur ?? null,
        finiLe: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(rechercheSessions.id, id), eq(rechercheSessions.instanceId, instanceId))),
  );
}

const DELAI_PERDUE = 2 * 60 * 60 * 1000;
const ETAT_TACHE = { en_cours: 'en_cours', terminee: 'terminee', interrompue: 'erreur' } as const;

// Les dernières sessions, recherches et enrichissements confondus, de la plus récente à la plus ancienne.
export async function dernieresSessions(
  db: Database,
  instanceId: string,
  limite = 20,
): Promise<SessionEnrichissement[]> {
  return withInstance(db, instanceId, async (tx) => {
    const recherches = await tx
      .select()
      .from(rechercheSessions)
      .where(eq(rechercheSessions.instanceId, instanceId))
      .orderBy(desc(rechercheSessions.createdAt))
      .limit(limite);
    const taches = await tx
      .select()
      .from(enrichissementTaches)
      .where(eq(enrichissementTaches.instanceId, instanceId))
      .orderBy(desc(enrichissementTaches.createdAt))
      .limit(limite);
    const lignes = taches.length
      ? await tx
          .select({ tacheId: enrichissementLignes.tacheId, etat: enrichissementLignes.etat })
          .from(enrichissementLignes)
          .where(eq(enrichissementLignes.instanceId, instanceId))
      : [];
    const parTache = new Map<string, { total: number; echecs: number }>();
    for (const l of lignes) {
      const c = parTache.get(l.tacheId) ?? { total: 0, echecs: 0 };
      c.total += 1;
      if (l.etat === 'echec') c.echecs += 1;
      parTache.set(l.tacheId, c);
    }
    const sessions: SessionEnrichissement[] = [
      ...recherches.map((r) => {
        // Un redémarrage de l'app interrompt la recherche sans la clore : au-delà de 2 h, elle est considérée perdue.
        const perdue = r.etat === 'en_cours' && Date.now() - r.createdAt.getTime() > DELAI_PERDUE;
        return {
          id: r.id,
          date: r.createdAt.toISOString(),
          nature: 'recherche' as const,
          libelle: 'Recherche de nouveaux prospects',
          mode: r.mode,
          etat: perdue ? ('erreur' as const) : r.etat,
          traites: r.trouves,
          ajoutees: r.ajoutees,
          detail: perdue ? 'Recherche interrompue.' : r.erreur,
        };
      }),
      ...taches.map((t) => {
        const c = parTache.get(t.id) ?? { total: 0, echecs: 0 };
        return {
          id: t.id,
          date: t.createdAt.toISOString(),
          nature: 'enrichissement' as const,
          libelle: t.type === 'contacts' ? 'Recherche de contacts' : 'Complément de fiches',
          mode: 'manuel' as const,
          etat: ETAT_TACHE[t.etat],
          traites: c.total,
          ajoutees: null,
          detail: t.erreur ?? (c.echecs ? `${c.echecs} fiche(s) en échec` : null),
        };
      }),
    ];
    return sessions.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limite);
  });
}
