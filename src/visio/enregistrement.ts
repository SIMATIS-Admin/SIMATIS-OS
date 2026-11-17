import { and, asc, eq, lt } from 'drizzle-orm';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import {
  enregistrementsVisio,
  morceauxVisio,
  type EnregistrementVisio,
  type MorceauVisio,
  type Piste,
} from './schema.js';

export const INACTIVITE_MAX_MS = 10 * 60_000;

export class SessionIntrouvable extends Error {
  constructor() {
    super('Session introuvable');
  }
}
export class SessionCloseErreur extends Error {
  constructor() {
    super('Session déjà close');
  }
}

export type MorceauRecu = {
  piste: Piste;
  rang: number;
  debutMs: number;
  mime?: string;
  audio?: Buffer;
  // Texte déjà transcrit (appli à part qui transcrit elle-même) : aucun son à traiter.
  texte?: string;
};

// Une session en cours par rendez-vous : une capture relancée reprend la même.
export async function ouvrirSession(tx: Tx, rendezVousId: string): Promise<{ id: string }> {
  const [existante] = await tx
    .select({ id: enregistrementsVisio.id })
    .from(enregistrementsVisio)
    .where(
      and(
        eq(enregistrementsVisio.instanceId, currentInstance),
        eq(enregistrementsVisio.rendezVousId, rendezVousId),
        eq(enregistrementsVisio.statut, 'en_cours'),
      ),
    );
  if (existante) return existante;
  const [cree] = await tx
    .insert(enregistrementsVisio)
    .values({ instanceId: currentInstance, rendezVousId })
    .returning({ id: enregistrementsVisio.id });
  if (!cree) throw new Error('Session non créée');
  return cree;
}

export async function recevoirMorceau(tx: Tx, id: string, m: MorceauRecu): Promise<void> {
  const [session] = await tx
    .select({ statut: enregistrementsVisio.statut })
    .from(enregistrementsVisio)
    .where(
      and(eq(enregistrementsVisio.instanceId, currentInstance), eq(enregistrementsVisio.id, id)),
    );
  if (!session) throw new SessionIntrouvable();
  if (session.statut !== 'en_cours') throw new SessionCloseErreur();
  await tx
    .insert(morceauxVisio)
    .values({
      instanceId: currentInstance,
      enregistrementId: id,
      piste: m.piste,
      rang: m.rang,
      debutMs: m.debutMs,
      mime: m.mime ?? 'audio/webm',
      audio: m.texte === undefined ? (m.audio ?? null) : null,
      texte: m.texte ?? null,
    })
    // Un morceau reçu deux fois (nouvel essai du navigateur) garde le premier exemplaire.
    .onConflictDoUpdate({
      target: [morceauxVisio.enregistrementId, morceauxVisio.piste, morceauxVisio.rang],
      set: m.texte === undefined ? { updatedAt: new Date() } : { texte: m.texte, audio: null },
    });
  await tx
    .update(enregistrementsVisio)
    .set({ dernierMorceauAt: new Date() })
    .where(eq(enregistrementsVisio.id, id));
}

// Le texte d'un morceau arrive de l'exécuteur après la clôture : ce n'est pas un nouveau morceau,
// donc la session n'a pas besoin d'être ouverte. Le son est supprimé dès que le texte est posé.
export async function poserTexte(
  tx: Tx,
  id: string,
  piste: Piste,
  rang: number,
  texte: string,
): Promise<void> {
  await tx
    .update(morceauxVisio)
    .set({ texte, audio: null })
    .where(
      and(
        eq(morceauxVisio.instanceId, currentInstance),
        eq(morceauxVisio.enregistrementId, id),
        eq(morceauxVisio.piste, piste),
        eq(morceauxVisio.rang, rang),
      ),
    );
}

export async function clore(tx: Tx, id: string, maintenant = new Date()): Promise<void> {
  await tx
    .update(enregistrementsVisio)
    .set({ statut: 'clos', finAt: maintenant })
    .where(
      and(
        eq(enregistrementsVisio.instanceId, currentInstance),
        eq(enregistrementsVisio.id, id),
        eq(enregistrementsVisio.statut, 'en_cours'),
      ),
    );
}

// Navigateur fermé en cours de route : la session muette est close, et ce qui est arrivé est transcrit.
export async function cloturerAbandonnees(tx: Tx, maintenant: Date): Promise<number> {
  const rows = await tx
    .update(enregistrementsVisio)
    .set({ statut: 'clos', finAt: maintenant })
    .where(
      and(
        eq(enregistrementsVisio.instanceId, currentInstance),
        eq(enregistrementsVisio.statut, 'en_cours'),
        lt(
          enregistrementsVisio.dernierMorceauAt,
          new Date(maintenant.getTime() - INACTIVITE_MAX_MS),
        ),
      ),
    )
    .returning({ id: enregistrementsVisio.id });
  return rows.length;
}

const ORDRE_PISTE: Record<Piste, number> = { moi: 0, autres: 1 };
const NOM_PISTE: Record<Piste, string> = { moi: 'Moi', autres: 'Autres' };

export function assemblerTranscript(
  morceaux: Pick<MorceauVisio, 'piste' | 'rang' | 'debutMs' | 'texte'>[],
): string {
  return [...morceaux]
    .sort(
      (x, y) =>
        x.debutMs - y.debutMs || ORDRE_PISTE[x.piste] - ORDRE_PISTE[y.piste] || x.rang - y.rang,
    )
    .flatMap((m) => {
      const texte = (m.texte ?? '').trim();
      return texte ? [`${NOM_PISTE[m.piste]} : ${texte}`] : [];
    })
    .join('\n');
}

// Écrit le transcript et supprime le son quand la session est close et que chaque morceau a son texte.
export async function finaliser(tx: Tx, id: string): Promise<boolean> {
  const session = await lireSession(tx, id);
  if (!session || session.statut !== 'clos') return false;
  if (session.morceaux.some((m) => m.texte === null)) return false;
  await tx
    .update(enregistrementsVisio)
    .set({ statut: 'transcrit', transcript: assemblerTranscript(session.morceaux) })
    .where(eq(enregistrementsVisio.id, id));
  await tx.update(morceauxVisio).set({ audio: null }).where(eq(morceauxVisio.enregistrementId, id));
  return true;
}

export async function lireSession(
  tx: Tx,
  id: string,
): Promise<(EnregistrementVisio & { morceaux: MorceauVisio[] }) | null> {
  const [session] = await tx
    .select()
    .from(enregistrementsVisio)
    .where(
      and(eq(enregistrementsVisio.instanceId, currentInstance), eq(enregistrementsVisio.id, id)),
    );
  if (!session) return null;
  const morceaux = await tx
    .select()
    .from(morceauxVisio)
    .where(eq(morceauxVisio.enregistrementId, id))
    .orderBy(asc(morceauxVisio.debutMs), asc(morceauxVisio.rang));
  return { ...session, morceaux };
}
