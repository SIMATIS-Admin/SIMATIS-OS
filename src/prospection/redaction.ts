import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { sansSignature } from '../connecteurs/google/google.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { CampagneInvalide } from './campagnes.js';
import { prospectionBrouillons, prospectionCampagnes } from './schema.js';

// Même délai que les demandes de routine et l'Ajout de l'Inbox : au-delà, l'exécuteur est réputé arrêté.
export const DELAI_PRISE_MS = 15 * 60_000;
export const MOTIF_SANS_PRISE =
  "L'exécuteur n'a pas pris la demande en 15 minutes. Vérifiez qu'il tourne sur l'ordinateur, puis relancez la rédaction.";
const NOTE_MANQUANT =
  "Claude n'a pas rédigé ce brouillon : rédigez-le vous-même ou relancez la rédaction.";

// Le mail de Claude est du HTML venu d'un modèle qui lit des mails extérieurs : on en retire ce qui
// s'exécute ou charge quelque chose, puis toute signature (l'OS ajoute la sienne, en image).
export function nettoyerCorps(html: string): string {
  const propre = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|link|meta)\b[^>]*>/gi, '')
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|data|vbscript):[^"']*\2/gi, '$1=$2#$2');
  return sansSignature(propre);
}

// 3 créneaux par mail, pris dans la réserve du lot à partir de (3 × rang) : deux mails voisins ne
// proposent pas les mêmes, tant que la réserve le permet.
export function attribuerCreneaux(reserve: string[], nbMails: number): string[][] {
  return Array.from({ length: nbMails }, (_, i) => {
    if (reserve.length === 0) return [];
    const k = Math.min(3, reserve.length);
    return Array.from({ length: k }, (_, j) => reserve[(3 * i + j) % reserve.length] as string);
  });
}

export async function campagnesEnAttente(tx: Executor) {
  return tx
    .select({ id: prospectionCampagnes.id, mode: prospectionCampagnes.mode })
    .from(prospectionCampagnes)
    .where(
      and(
        eq(prospectionCampagnes.instanceId, currentInstance),
        eq(prospectionCampagnes.statut, 'redaction'),
        isNull(prospectionCampagnes.demarreAt),
      ),
    );
}

// Prise par l'exécuteur : une seule fois, pour que deux exécuteurs ne rédigent pas le même lot.
export async function demarrerCampagne(tx: Executor, id: string) {
  const rows = await tx
    .update(prospectionCampagnes)
    .set({ demarreAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(prospectionCampagnes.instanceId, currentInstance),
        eq(prospectionCampagnes.id, id),
        eq(prospectionCampagnes.statut, 'redaction'),
        isNull(prospectionCampagnes.demarreAt),
      ),
    )
    .returning({ id: prospectionCampagnes.id });
  if (rows.length === 0) throw new CampagneInvalide('Campagne déjà prise ou introuvable.');
}

export type BrouillonRedige = {
  id: string;
  objet: string;
  corps: string;
  threadId?: string | undefined;
  aVerifier?: string | undefined;
};

// Dépôt de Claude (outil campagne_deposer). Tout est vérifié avant la moindre écriture.
export async function deposerBrouillons(
  tx: Executor,
  campagneId: string,
  items: BrouillonRedige[],
) {
  const [campagne] = await tx
    .select({ statut: prospectionCampagnes.statut, demarreAt: prospectionCampagnes.demarreAt })
    .from(prospectionCampagnes)
    .where(
      and(
        eq(prospectionCampagnes.instanceId, currentInstance),
        eq(prospectionCampagnes.id, campagneId),
      ),
    );
  if (!campagne || campagne.statut !== 'redaction' || !campagne.demarreAt) {
    throw new CampagneInvalide("Cette campagne n'attend pas de brouillons.");
  }
  const attendus = await tx
    .select({ id: prospectionBrouillons.id })
    .from(prospectionBrouillons)
    .where(
      and(
        eq(prospectionBrouillons.instanceId, currentInstance),
        eq(prospectionBrouillons.campagneId, campagneId),
        eq(prospectionBrouillons.etat, 'a_rediger'),
      ),
    );
  const ids = new Set(attendus.map((a) => a.id));
  const vus = new Set<string>();
  for (const it of items) {
    if (!ids.has(it.id) || vus.has(it.id)) {
      throw new CampagneInvalide(`Brouillon inconnu, déjà déposé ou non attendu : ${it.id}`);
    }
    vus.add(it.id);
    if (!it.objet.trim() || !it.corps.trim()) {
      throw new CampagneInvalide(`Brouillon incomplet : ${it.id}`);
    }
  }
  for (const it of items) {
    await tx
      .update(prospectionBrouillons)
      .set({
        objet: it.objet.trim().slice(0, 300),
        corps: nettoyerCorps(it.corps),
        threadId: it.threadId ?? null,
        etat: it.aVerifier ? 'a_verifier' : 'pret',
        note: it.aVerifier ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(prospectionBrouillons.instanceId, currentInstance),
          eq(prospectionBrouillons.id, it.id),
        ),
      );
  }
  if (items.length === ids.size) {
    await tx
      .update(prospectionCampagnes)
      .set({ statut: 'relecture', updatedAt: new Date() })
      .where(
        and(
          eq(prospectionCampagnes.instanceId, currentInstance),
          eq(prospectionCampagnes.id, campagneId),
        ),
      );
  }
}

// Fin du travail de l'exécuteur : ce que Claude n'a pas rédigé reste à la main de Marc.
export async function finirCampagne(tx: Executor, id: string, erreur?: string) {
  const [c] = await tx
    .select({ statut: prospectionCampagnes.statut })
    .from(prospectionCampagnes)
    .where(
      and(eq(prospectionCampagnes.instanceId, currentInstance), eq(prospectionCampagnes.id, id)),
    );
  if (!c || c.statut !== 'redaction') return;
  if (erreur) {
    await tx
      .update(prospectionCampagnes)
      .set({ statut: 'erreur', erreur, updatedAt: new Date() })
      .where(eq(prospectionCampagnes.id, id));
    return;
  }
  await tx
    .update(prospectionBrouillons)
    .set({ etat: 'a_verifier', note: NOTE_MANQUANT, updatedAt: new Date() })
    .where(
      and(
        eq(prospectionBrouillons.instanceId, currentInstance),
        eq(prospectionBrouillons.campagneId, id),
        eq(prospectionBrouillons.etat, 'a_rediger'),
      ),
    );
  await tx
    .update(prospectionCampagnes)
    .set({ statut: 'relecture', updatedAt: new Date() })
    .where(eq(prospectionCampagnes.id, id));
}

export async function relancerCampagne(tx: Executor, id: string) {
  const rows = await tx
    .update(prospectionCampagnes)
    .set({
      statut: 'redaction',
      erreur: null,
      demarreAt: null,
      demandeAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(prospectionCampagnes.instanceId, currentInstance),
        eq(prospectionCampagnes.id, id),
        eq(prospectionCampagnes.statut, 'erreur'),
      ),
    )
    .returning({ id: prospectionCampagnes.id });
  if (rows.length === 0)
    throw new CampagneInvalide('Seule une campagne en erreur peut être relancée.');
  await tx
    .update(prospectionBrouillons)
    .set({ etat: 'a_rediger', note: null, updatedAt: new Date() })
    .where(
      and(
        eq(prospectionBrouillons.instanceId, currentInstance),
        eq(prospectionBrouillons.campagneId, id),
        inArray(prospectionBrouillons.etat, ['a_rediger', 'a_verifier']),
      ),
    );
}

export async function abandonnerCampagnes(tx: Executor, maintenant = new Date()): Promise<number> {
  const rows = await tx
    .update(prospectionCampagnes)
    .set({ statut: 'erreur', erreur: MOTIF_SANS_PRISE, updatedAt: maintenant })
    .where(
      and(
        eq(prospectionCampagnes.instanceId, currentInstance),
        eq(prospectionCampagnes.statut, 'redaction'),
        isNull(prospectionCampagnes.demarreAt),
        lt(prospectionCampagnes.demandeAt, new Date(maintenant.getTime() - DELAI_PRISE_MS)),
      ),
    )
    .returning({ id: prospectionCampagnes.id });
  return rows.length;
}
