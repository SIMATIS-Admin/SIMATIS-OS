import { and, eq, or, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { enrichissementSuggestions } from '../enrichissement/schema.js';
import { ajouterNoteOrigine } from './integration.js';
import { clesDoublon, normaliserFiche } from './nettoyage.js';
import { baseVivante, type NoteOrigine } from './schema.js';

export type OrigineRecherche = {
  entreprise: string;
  prenom: string;
  nom: string;
  email: string | null;
  linkedin: string | null;
  qualification: string;
  source: string;
};

export async function noterContactsRecherches(
  db: Database,
  instanceId: string,
  contacts: OrigineRecherche[],
) {
  return withInstance(db, instanceId, async (tx) => {
    let renseignees = 0;
    for (const c of contacts) {
      const cles = clesDoublon(normaliserFiche(c).fiche);
      if (!cles.length) continue;
      const fiches = await tx
        .select({ id: baseVivante.id })
        .from(baseVivante)
        .where(
          and(
            eq(baseVivante.instanceId, instanceId),
            sql`${baseVivante.cles} ?| array[${sql.join(cles, sql`, `)}]::text[]`,
          ),
        );
      renseignees += fiches.length;
      for (const f of fiches)
        await ajouterNoteOrigine(tx, instanceId, f.id, {
          date: new Date().toISOString(),
          origine: 'Recherche Codex',
          texte: c.qualification,
          source: c.source,
        });
    }
    return { ok: true, renseignees };
  });
}

export async function lireOrigine(db: Database, instanceId: string, id: string) {
  return withInstance(db, instanceId, async (tx) => {
    const [f] = await tx
      .select()
      .from(baseVivante)
      .where(and(eq(baseVivante.instanceId, instanceId), eq(baseVivante.id, id)));
    if (!f) return null;
    const suggestions = await tx
      .select()
      .from(enrichissementSuggestions)
      .where(
        and(
          eq(enrichissementSuggestions.instanceId, instanceId),
          eq(enrichissementSuggestions.etat, 'acceptee'),
          or(
            f.email ? eq(enrichissementSuggestions.email, f.email) : undefined,
            f.linkedin ? eq(enrichissementSuggestions.linkedin, f.linkedin) : undefined,
            and(
              eq(enrichissementSuggestions.ficheId, id),
              eq(enrichissementSuggestions.nom, f.nom),
            ),
          ),
        ),
      );
    const notes: NoteOrigine[] = [...f.notesOrigine];
    if (!notes.some((n) => n.origine === 'Enrichissement Codex'))
      for (const s of suggestions)
        notes.push({
          date: s.createdAt.toISOString(),
          origine: 'Enrichissement Codex',
          texte: `${[s.prenom, s.nom, s.fonction].filter(Boolean).join(' · ')}. Confiance : ${s.confiance}.`,
          source: s.sourceUrl,
        });
    return { provenance: f.provenance, collecteLe: f.collecteLe, notes };
  });
}
