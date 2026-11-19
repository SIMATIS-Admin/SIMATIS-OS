import { baseVivante } from '../base-vivante/schema.js';
import { emailGenerique } from '../base-vivante/nettoyage.js';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  appliquerContact,
  enregistrerEmailEntreprise,
  ajouterNoteOrigine,
} from '../base-vivante/integration.js';
import { withInstance } from '../db/context.js';
import type { Executor, Tx } from '../db.js';
import { enrichissementSuggestions, LIBELLES_PREUVE, type Suggestion } from './schema.js';

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

// Écrit une suggestion dans la fiche : même chemin pour la validation de Marc et pour l'écriture
// automatique, afin que la note d'origine et le rapprochement des doublons restent identiques.
export async function appliquerSuggestion(
  tx: Tx,
  instanceId: string,
  s: Suggestion,
  auto: boolean,
): Promise<{ creee: boolean }> {
  const adresseEntreprise = s.emailEntreprise ?? (emailGenerique(s.email) ? s.email : null);
  const r = await appliquerContact(tx, instanceId, s.ficheId, {
    prenom: s.prenom ?? undefined,
    nom: s.nom ?? undefined,
    email: emailGenerique(s.email) ? undefined : (s.email ?? undefined),
    linkedin: s.linkedin ?? undefined,
    telephone: s.telephone ?? undefined,
    fonction: s.fonction ?? undefined,
  });
  // Une écriture automatique complète la fiche existante : si le rapprochement échoue et crée un
  // doublon, on annule tout (la suggestion reste à valider) plutôt que de multiplier les fiches.
  if (auto && r.creee) throw new Error('Rapprochement impossible : écriture automatique annulée');
  const preuve = s.preuve ? LIBELLES_PREUVE[s.preuve] : `confiance ${s.confiance}`;
  await ajouterNoteOrigine(tx, instanceId, r.id, {
    date: new Date().toISOString(),
    origine: 'Enrichissement Codex',
    texte: `${auto ? 'Contact complété automatiquement' : 'Contact vérifié'} : ${[s.prenom, s.nom, s.fonction].filter(Boolean).join(' · ')}. Preuve : ${preuve}. Email : ${s.modeEmail === 'deduit' ? 'déduit, à vérifier' : 'publié ou non renseigné'}.`,
    source: s.sourceUrl,
  });
  if (adresseEntreprise) {
    await enregistrerEmailEntreprise(tx, instanceId, r.id, adresseEntreprise);
  }
  await tx
    .update(enrichissementSuggestions)
    .set({ etat: 'acceptee', appliqueeAuto: auto, updatedAt: new Date() })
    .where(eq(enrichissementSuggestions.id, s.id));
  return { creee: r.creee };
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
      const r = await withInstance(db, instanceId, (tx) =>
        appliquerSuggestion(tx, instanceId, s, false),
      );
      bilan.appliquees++;
      if (r.creee) bilan.creees++;
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
