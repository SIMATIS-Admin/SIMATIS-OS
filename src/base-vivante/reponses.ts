import { and, asc, count, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import { FicheIntrouvable, majConformite, majHistorique } from './integration.js';
import { baseReponses, baseVivante, RESULTATS, type Resultat } from './schema.js';

export class ReponseIntrouvable extends Error {}
export class ClasseRefusee extends Error {}

export const CLASSES = [...RESULTATS, 'ne_plus_contacter'] as const;
export type Classe = (typeof CLASSES)[number];

// What a reply says about the prospect, once judged: only these classes move the record.
const RESULTAT_DE_CLASSE: Record<Classe, Resultat> = {
  sans_reponse: 'sans_reponse',
  repondu: 'repondu',
  interesse: 'interesse',
  pas_interesse: 'pas_interesse',
  mauvais_interlocuteur: 'mauvais_interlocuteur',
  reponse_auto: 'reponse_auto',
  ne_plus_contacter: 'pas_interesse',
};

export type ReponseVue = {
  id: string;
  ficheId: string;
  entreprise: string;
  contact: string;
  mandat: string;
  recuLe: Date;
  objet: string | null;
  extrait: string;
  classe: Classe | null;
};

const colonnes = {
  id: baseReponses.id,
  ficheId: baseReponses.ficheId,
  entreprise: baseVivante.entreprise,
  prenom: baseVivante.prenom,
  nom: baseVivante.nom,
  mandat: baseReponses.mandat,
  recuLe: baseReponses.recuLe,
  objet: baseReponses.objet,
  extrait: baseReponses.extrait,
  classe: baseReponses.classe,
};

const vue = (r: {
  id: string;
  ficheId: string;
  entreprise: string;
  prenom: string | null;
  nom: string;
  mandat: string;
  recuLe: Date;
  objet: string | null;
  extrait: string;
  classe: Classe | null;
}): ReponseVue => ({
  id: r.id,
  ficheId: r.ficheId,
  entreprise: r.entreprise,
  contact: [r.prenom, r.nom].filter(Boolean).join(' '),
  mandat: r.mandat,
  recuLe: r.recuLe,
  objet: r.objet,
  extrait: r.extrait,
  classe: r.classe,
});

// Replies Claude has not judged yet (the routine reads these).
export async function reponsesAClasser(
  db: Executor,
  instanceId: string,
  limite = 50,
): Promise<ReponseVue[]> {
  return withInstance(db, instanceId, async (tx) =>
    (
      await tx
        .select(colonnes)
        .from(baseReponses)
        .innerJoin(baseVivante, eq(baseVivante.id, baseReponses.ficheId))
        .where(
          and(
            eq(baseReponses.instanceId, instanceId),
            isNull(baseReponses.classe),
            eq(baseReponses.validee, false),
          ),
        )
        .orderBy(asc(baseReponses.recuLe))
        .limit(Math.min(limite, 200))
    ).map(vue),
  );
}

// Replies judged by Claude and waiting for the pilot's check.
export async function reponsesAValider(db: Executor, instanceId: string): Promise<ReponseVue[]> {
  return withInstance(db, instanceId, async (tx) =>
    (
      await tx
        .select(colonnes)
        .from(baseReponses)
        .innerJoin(baseVivante, eq(baseVivante.id, baseReponses.ficheId))
        .where(
          and(
            eq(baseReponses.instanceId, instanceId),
            isNotNull(baseReponses.classe),
            eq(baseReponses.validee, false),
          ),
        )
        .orderBy(asc(baseReponses.recuLe))
        .limit(200)
    ).map(vue),
  );
}

export async function compterReponses(db: Executor, instanceId: string) {
  const [r] = await withInstance(db, instanceId, (tx) =>
    tx
      .select({ n: count() })
      .from(baseReponses)
      .where(
        and(
          eq(baseReponses.instanceId, instanceId),
          isNull(baseReponses.classe),
          eq(baseReponses.validee, false),
        ),
      ),
  );
  return { aClasser: r?.n ?? 0 };
}

// Claude's proposal: it never touches the record, only the reply.
export async function proposerClasse(
  db: Executor,
  instanceId: string,
  reponseId: string,
  classe: Classe,
): Promise<void> {
  await withInstance(db, instanceId, async (tx) => {
    const [r] = await tx
      .update(baseReponses)
      .set({ classe, updatedAt: new Date() })
      .where(
        and(
          eq(baseReponses.id, reponseId),
          eq(baseReponses.instanceId, instanceId),
          eq(baseReponses.validee, false),
        ),
      )
      .returning({ id: baseReponses.id });
    if (!r) throw new ReponseIntrouvable('Réponse introuvable ou déjà validée');
  });
}

// The pilot validates (or changes) the class: only then does the record move. « Ne plus me
// contacter » becomes an opposition, which wins over everything else.
export async function validerReponse(
  db: Executor,
  instanceId: string,
  reponseId: string,
  classe?: Classe,
): Promise<void> {
  await withInstance(db, instanceId, async (tx) => {
    const [r] = await tx
      .select()
      .from(baseReponses)
      .where(and(eq(baseReponses.id, reponseId), eq(baseReponses.instanceId, instanceId)));
    if (!r || r.validee) throw new ReponseIntrouvable('Réponse introuvable ou déjà validée');
    const finale = classe ?? r.classe;
    if (!finale) throw new ClasseRefusee('Choisissez une classe avant de valider.');
    const [pris] = await tx
      .update(baseReponses)
      .set({ classe: finale, validee: true, updatedAt: new Date() })
      .where(and(eq(baseReponses.id, reponseId), eq(baseReponses.validee, false)))
      .returning({ id: baseReponses.id });
    if (!pris) throw new ReponseIntrouvable('Réponse introuvable ou déjà validée');
    try {
      await majHistorique(tx, instanceId, r.ficheId, { resultat: RESULTAT_DE_CLASSE[finale] });
      if (finale === 'ne_plus_contacter')
        await majConformite(tx, instanceId, r.ficheId, { opposition: true });
    } catch (error) {
      if (error instanceof FicheIntrouvable) throw new ReponseIntrouvable('Fiche supprimée');
      throw error;
    }
  });
}
