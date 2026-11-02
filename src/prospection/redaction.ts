import { and, eq, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { sansSignature } from '../connecteurs/google/google.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { CampagneIntrouvable, CampagneInvalide } from './campagnes.js';
import { prospectionBrouillons, prospectionCampagnes, prospectionOccurrences } from './schema.js';

// Même délai que les demandes de routine et l'Ajout de l'Inbox : au-delà, l'exécuteur est réputé arrêté.
export const DELAI_PRISE_MS = 15 * 60_000;
export const MOTIF_SANS_PRISE =
  "L'exécuteur n'a pas pris la demande en 15 minutes. Vérifiez qu'il tourne sur l'ordinateur, puis relancez la rédaction.";
const NOTE_MANQUANT =
  "Claude n'a pas rédigé ce brouillon : rédigez-le vous-même ou relancez la rédaction.";
const NOTE_REFORMULATION_ECHEC =
  "La reformulation n'a pas abouti : l'ancien texte est conservé. Modifiez-le vous-même ou redemandez.";
export const CONSIGNE_MAX = 1000;

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
        // Sans fil renvoyé par Claude, celui de l'entrée d'origine (réponse) est conservé.
        ...(it.threadId ? { threadId: it.threadId } : {}),
        etat: it.aVerifier ? 'a_verifier' : 'pret',
        note: it.aVerifier ?? null,
        consigne: null,
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

// Remet à relire les mails dont la reformulation n'a pas été rendue : leur texte n'a pas changé.
async function annulerReformulations(tx: Executor, campagneId: string): Promise<number> {
  const rows = await tx
    .update(prospectionBrouillons)
    .set({
      etat: 'a_verifier',
      note: NOTE_REFORMULATION_ECHEC,
      consigne: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(prospectionBrouillons.instanceId, currentInstance),
        eq(prospectionBrouillons.campagneId, campagneId),
        eq(prospectionBrouillons.etat, 'a_rediger'),
        isNotNull(prospectionBrouillons.consigne),
      ),
    )
    .returning({ id: prospectionBrouillons.id });
  return rows.length;
}

// Marc demande à Claude de reformuler des mails de la relecture : chaque mail repasse « à rédiger »
// avec la même demande, la campagne repart chez l'exécuteur, les autres mails ne bougent pas.
// Sans `ids`, tous les mails encore reformulables sont concernés (ni écartés, ni déjà créés).
async function reformuler(
  tx: Executor,
  campagneId: string,
  consigne: string,
  ids?: string[],
): Promise<number> {
  const demande = consigne.trim();
  if (!demande) throw new CampagneInvalide('Dites à Claude ce que vous voulez changer.');
  if (demande.length > CONSIGNE_MAX) throw new CampagneInvalide('La demande est trop longue.');
  const [c] = await tx
    .select({ statut: prospectionCampagnes.statut })
    .from(prospectionCampagnes)
    .where(
      and(
        eq(prospectionCampagnes.instanceId, currentInstance),
        eq(prospectionCampagnes.id, campagneId),
      ),
    );
  if (!c) throw new CampagneIntrouvable('Campagne introuvable.');
  if (c.statut === 'redaction') throw new CampagneInvalide('Une reformulation est déjà en cours.');
  if (c.statut !== 'relecture')
    throw new CampagneInvalide("Cette campagne n'est plus en relecture.");
  const rows = await tx
    .update(prospectionBrouillons)
    .set({ etat: 'a_rediger', consigne: demande, note: null, updatedAt: new Date() })
    .where(
      and(
        eq(prospectionBrouillons.instanceId, currentInstance),
        eq(prospectionBrouillons.campagneId, campagneId),
        ...(ids ? [inArray(prospectionBrouillons.id, ids)] : []),
        inArray(prospectionBrouillons.etat, ['pret', 'a_verifier']),
        isNotNull(prospectionBrouillons.corps),
      ),
    )
    .returning({ id: prospectionBrouillons.id });
  if (rows.length === 0) {
    throw new CampagneInvalide('Ce mail ne peut pas être reformulé (écarté, déjà créé ou vide).');
  }
  await tx
    .update(prospectionCampagnes)
    .set({
      statut: 'redaction',
      erreur: null,
      demarreAt: null,
      demandeAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(prospectionCampagnes.id, campagneId));
  return rows.length;
}

export async function demanderReformulation(
  tx: Executor,
  campagneId: string,
  brouillonId: string,
  consigne: string,
) {
  await reformuler(tx, campagneId, consigne, [brouillonId]);
}

// Même demande pour plusieurs mails d'un coup (les `ids`, ou tous). Rend le nombre de mails concernés.
export const demanderReformulations = (
  tx: Executor,
  campagneId: string,
  consigne: string,
  ids?: string[],
) => reformuler(tx, campagneId, consigne, ids);

// Fin du travail de l'exécuteur : ce que Claude n'a pas rédigé reste à la main de Marc.
export async function finirCampagne(tx: Executor, id: string, erreur?: string) {
  const [c] = await tx
    .select({ statut: prospectionCampagnes.statut })
    .from(prospectionCampagnes)
    .where(
      and(eq(prospectionCampagnes.instanceId, currentInstance), eq(prospectionCampagnes.id, id)),
    );
  if (!c || c.statut !== 'redaction') return;
  // Une reformulation qui échoue ne fait pas tomber la campagne : l'ancien texte reste à relire.
  if ((await annulerReformulations(tx, id)) > 0) {
    await tx
      .update(prospectionCampagnes)
      .set({ statut: 'relecture', updatedAt: new Date() })
      .where(eq(prospectionCampagnes.id, id));
    return;
  }
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
  const perimees = await tx
    .select({ id: prospectionCampagnes.id })
    .from(prospectionCampagnes)
    .where(
      and(
        eq(prospectionCampagnes.instanceId, currentInstance),
        eq(prospectionCampagnes.statut, 'redaction'),
        isNull(prospectionCampagnes.demarreAt),
        lt(prospectionCampagnes.demandeAt, new Date(maintenant.getTime() - DELAI_PRISE_MS)),
      ),
    );
  for (const { id } of perimees) {
    // Une reformulation jamais prise rend la campagne à la relecture, pas en erreur.
    const reprise = (await annulerReformulations(tx, id)) > 0;
    await tx
      .update(prospectionCampagnes)
      .set(
        reprise
          ? { statut: 'relecture', updatedAt: maintenant }
          : { statut: 'erreur', erreur: MOTIF_SANS_PRISE, updatedAt: maintenant },
      )
      .where(eq(prospectionCampagnes.id, id));
  }
  return perimees.length;
}

// Marc renonce aux campagnes qui ne sont pas allées au bout (relecture jamais finie, erreur,
// rédaction restée en plan) : elles disparaissent avec leurs brouillons de relecture. Les mails
// déjà partis restent comptés ; les brouillons de messagerie créés par une finalisation incomplète
// n'ont pas été envoyés, leur occurrence est retirée pour ne pas être confondue avec un envoi futur.
export async function abandonnerCampagnesEnCours(tx: Executor): Promise<number> {
  const enCours = await tx
    .select({ id: prospectionCampagnes.id })
    .from(prospectionCampagnes)
    .where(
      and(
        eq(prospectionCampagnes.instanceId, currentInstance),
        ne(prospectionCampagnes.statut, 'terminee'),
      ),
    );
  if (enCours.length === 0) return 0;
  const ids = enCours.map((c) => c.id);
  await tx
    .delete(prospectionOccurrences)
    .where(
      and(
        eq(prospectionOccurrences.instanceId, currentInstance),
        eq(prospectionOccurrences.etat, 'brouillon'),
        inArray(prospectionOccurrences.lot, ids),
      ),
    );
  await tx
    .delete(prospectionCampagnes)
    .where(
      and(
        eq(prospectionCampagnes.instanceId, currentInstance),
        inArray(prospectionCampagnes.id, ids),
      ),
    );
  return ids.length;
}
