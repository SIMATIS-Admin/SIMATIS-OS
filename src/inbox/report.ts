import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { propositions } from '../propositions/schema.js';
import { SOURCE_MANUELLE, sujets, type TypeSujet } from './schema.js';

export type SujetTraite = {
  id: string;
  type: TypeSujet;
  titre: string;
  statut: 'tache' | 'traite';
  traiteAt: string | null;
  traitePar: string | null;
  tacheId: string | null;
  source: string;
  sourceId: string | null;
  lien: string | null;
  // Proposals only: what the pilot decided, and the note to export when a second-brain note was
  // validated. A rejected note is only reported as handled.
  decision: 'appliquee' | 'ecartee' | 'echec' | null;
  note: { titre: string; texte: string; destination: string | null } | null;
};

const LIMITE = 200;
const texte = (v: unknown) => (typeof v === 'string' ? v : null);

// Handled subjects the Inbox routine has not reported into the second brain yet, oldest first.
export async function sujetsTraites(tx: Tx): Promise<SujetTraite[]> {
  const rows = await tx
    .select({
      sujet: sujets,
      propType: propositions.type,
      propStatut: propositions.statut,
      propContenu: propositions.contenu,
    })
    .from(sujets)
    .leftJoin(
      propositions,
      and(eq(propositions.id, sujets.propositionId), eq(propositions.instanceId, currentInstance)),
    )
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        ne(sujets.statut, 'a_traiter'),
        isNull(sujets.reporteAt),
      ),
    )
    .orderBy(asc(sujets.traiteAt))
    .limit(LIMITE);
  return rows.map(({ sujet: s, propType, propStatut, propContenu }) => {
    const decision =
      propStatut === 'appliquee' || propStatut === 'ecartee' || propStatut === 'echec'
        ? propStatut
        : null;
    const c = (propContenu ?? {}) as Record<string, unknown>;
    const titre = texte(c.titre);
    const corps = texte(c.texte);
    return {
      id: s.id,
      type: s.type,
      titre: s.titre,
      statut: s.statut === 'tache' ? 'tache' : 'traite',
      traiteAt: s.traiteAt?.toISOString() ?? null,
      traitePar: s.traitePar,
      tacheId: s.tacheId,
      source: s.source,
      sourceId: s.sourceId,
      lien: s.lien,
      decision,
      note:
        propType === 'note.second_cerveau' && decision === 'appliquee' && titre && corps
          ? { titre, texte: corps, destination: texte(c.destination) }
          : null,
    };
  });
}

// After the routine wrote the trace (or exported the note) into the second brain. Subjects of
// another instance, still to handle, or already reported are left alone.
export async function marquerReporte(tx: Tx, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx
    .update(sujets)
    .set({ reporteAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        inArray(sujets.id, ids),
        ne(sujets.statut, 'a_traiter'),
        isNull(sujets.reporteAt),
      ),
    )
    .returning({ id: sujets.id });
  return rows.length;
}

export type SujetAjoute = {
  id: string;
  titre: string;
  resume: string | null;
  echeance: string | null;
  createdAt: string;
};

// Entries the pilot added by hand that the Inbox routine has not noted in the second brain yet.
export async function sujetsAjoutes(tx: Tx): Promise<SujetAjoute[]> {
  const rows = await tx
    .select()
    .from(sujets)
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.source, SOURCE_MANUELLE),
        isNull(sujets.noteCerveauAt),
      ),
    )
    .orderBy(asc(sujets.createdAt))
    .limit(LIMITE);
  return rows.map((s) => ({
    id: s.id,
    titre: s.titre,
    resume: s.resume,
    echeance: s.echeance?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  }));
}

// After the routine wrote the note in the second brain. Other entries are left alone.
export async function marquerNoteCerveau(tx: Tx, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx
    .update(sujets)
    .set({ noteCerveauAt: new Date() })
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.source, SOURCE_MANUELLE),
        inArray(sujets.id, ids),
        isNull(sujets.noteCerveauAt),
      ),
    )
    .returning({ id: sujets.id });
  return rows.length;
}
