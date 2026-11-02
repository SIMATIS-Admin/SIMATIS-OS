import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { appliquerContact } from '../base-vivante/integration.js';
import { baseVivante } from '../base-vivante/schema.js';
import { withInstance } from '../db/context.js';
import type { Executor } from '../db.js';
import { enrichissementSuggestions, type Suggestion } from './schema.js';

export type SuggestionAffichee = Suggestion & {
  entreprise: string;
  contactExistant: string | null;
};

export async function suggestionsDeLaTache(
  db: Executor,
  instanceId: string,
  tacheId: string,
): Promise<SuggestionAffichee[]> {
  const lignes = await withInstance(db, instanceId, (tx) =>
    tx
      .select({ s: enrichissementSuggestions, f: baseVivante })
      .from(enrichissementSuggestions)
      .innerJoin(baseVivante, eq(baseVivante.id, enrichissementSuggestions.ficheId))
      .where(eq(enrichissementSuggestions.tacheId, tacheId))
      .orderBy(
        // « a_valider » avant les autres, puis regroupées par entreprise.
        desc(eq(enrichissementSuggestions.etat, 'a_valider')),
        asc(baseVivante.entreprise),
        asc(enrichissementSuggestions.createdAt),
      ),
  );
  return lignes.map(({ s, f }) => ({
    ...s,
    entreprise: f.entreprise,
    contactExistant: [f.prenom, f.nom].filter(Boolean).join(' ') || null,
  }));
}

// Seules les suggestions cochées entrent dans la base ; chacune est appliquée dans sa propre
// transaction, une fiche en difficulté ne bloque pas les autres.
export async function valider(
  db: Executor,
  instanceId: string,
  tacheId: string,
  accepter: string[],
  refuser: string[],
): Promise<{ appliquees: number; creees: number; echecs: number }> {
  const bilan = { appliquees: 0, creees: 0, echecs: 0 };
  const aTraiter = async (ids: string[]) =>
    ids.length === 0
      ? []
      : withInstance(db, instanceId, (tx) =>
          tx
            .select()
            .from(enrichissementSuggestions)
            .where(
              and(
                eq(enrichissementSuggestions.tacheId, tacheId),
                eq(enrichissementSuggestions.etat, 'a_valider'),
                inArray(enrichissementSuggestions.id, ids),
              ),
            )
            .orderBy(asc(enrichissementSuggestions.createdAt)),
        );

  for (const s of await aTraiter(accepter)) {
    try {
      await withInstance(db, instanceId, async (tx) => {
        const r = await appliquerContact(tx, instanceId, s.ficheId, {
          prenom: s.prenom ?? undefined,
          nom: s.nom ?? undefined,
          email: s.email ?? undefined,
          telephone: s.telephone ?? undefined,
          fonction: s.fonction ?? undefined,
        });
        await tx
          .update(enrichissementSuggestions)
          .set({ etat: 'acceptee', updatedAt: new Date() })
          .where(eq(enrichissementSuggestions.id, s.id));
        bilan.appliquees++;
        if (r.creee) bilan.creees++;
      });
    } catch {
      bilan.echecs++;
    }
  }
  const refusees = await aTraiter(refuser);
  if (refusees.length > 0)
    await withInstance(db, instanceId, (tx) =>
      tx
        .update(enrichissementSuggestions)
        .set({ etat: 'refusee', updatedAt: new Date() })
        .where(
          inArray(
            enrichissementSuggestions.id,
            refusees.map((r) => r.id),
          ),
        ),
    );
  return bilan;
}
