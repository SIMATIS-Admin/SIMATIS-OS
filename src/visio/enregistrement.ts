import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { rendezVous } from '../crm/schema.js';
import { proposerResumeAuSujet } from '../inbox/sujet-rdv.js';
import { sujets } from '../inbox/schema.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import {
  enregistrementsVisio,
  morceauxVisio,
  type EnregistrementVisio,
  type MorceauVisio,
  type Piste,
} from './schema.js';

export const SOURCE_RDV_LIBRE = 'visio-libre';
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

// Les morceaux sans leur son : l'écran relit la session toutes les quelques secondes, le son
// (plusieurs Mo) ne doit pas suivre.
export type MorceauLu = Pick<
  MorceauVisio,
  'id' | 'enregistrementId' | 'piste' | 'rang' | 'debutMs' | 'mime' | 'texte'
> & { aAudio: boolean };

export async function lireSession(
  tx: Tx,
  id: string,
): Promise<(EnregistrementVisio & { morceaux: MorceauLu[] }) | null> {
  const [session] = await tx
    .select()
    .from(enregistrementsVisio)
    .where(
      and(eq(enregistrementsVisio.instanceId, currentInstance), eq(enregistrementsVisio.id, id)),
    );
  if (!session) return null;
  const morceaux = await tx
    .select({
      id: morceauxVisio.id,
      enregistrementId: morceauxVisio.enregistrementId,
      piste: morceauxVisio.piste,
      rang: morceauxVisio.rang,
      debutMs: morceauxVisio.debutMs,
      mime: morceauxVisio.mime,
      texte: morceauxVisio.texte,
      aAudio: sql<boolean>`${morceauxVisio.audio} is not null`,
    })
    .from(morceauxVisio)
    .where(eq(morceauxVisio.enregistrementId, id))
    .orderBy(asc(morceauxVisio.debutMs), asc(morceauxVisio.rang));
  return { ...session, morceaux };
}

// Une session close sans morceau (navigateur fermé tout de suite) n'attend aucun texte : personne
// ne viendra la finaliser, on le fait ici.
export async function finaliserCloses(tx: Tx): Promise<number> {
  const closes = await tx
    .select({ id: enregistrementsVisio.id })
    .from(enregistrementsVisio)
    .where(
      and(
        eq(enregistrementsVisio.instanceId, currentInstance),
        eq(enregistrementsVisio.statut, 'clos'),
      ),
    );
  let n = 0;
  for (const { id } of closes) if (await finaliser(tx, id)) n++;
  return n;
}

const dateParis = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
const heureParis = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    .replace(':', 'h');

// Enregistrement lancé hors agenda : l'OS lui crée un rendez-vous à l'instant, sans copie dans
// Google (aucune invitation, aucun événement). Marc le rattache ensuite à qui il veut.
export async function creerRendezVousLibre(tx: Tx, maintenant = new Date()): Promise<string> {
  const [ligne] = await tx
    .insert(rendezVous)
    .values({
      instanceId: currentInstance,
      eventId: `os:${randomUUID()}`,
      titre: `Enregistrement du ${dateParis(maintenant)} à ${heureParis(maintenant)}`,
      debut: maintenant,
      fin: new Date(maintenant.getTime() + 3_600_000),
      participants: [],
      statut: 'rdv',
      // Marque les rendez-vous créés par un enregistrement libre : supprimés avec lui s'ils restent vides.
      source: SOURCE_RDV_LIBRE,
    })
    .returning({ id: rendezVous.id });
  if (!ligne) throw new Error('Rendez-vous non créé');
  return ligne.id;
}

// Les enregistrements récents de l'instance, avec le rendez-vous auquel ils sont rattachés.
export async function listerEnregistrements(tx: Tx, limite = 20) {
  const lignes = await tx
    .select({
      id: enregistrementsVisio.id,
      rdvId: rendezVous.eventId,
      titre: rendezVous.titre,
      debutAt: enregistrementsVisio.debutAt,
      finAt: enregistrementsVisio.finAt,
      statut: enregistrementsVisio.statut,
      resume: enregistrementsVisio.resume,
    })
    .from(enregistrementsVisio)
    .innerJoin(rendezVous, eq(rendezVous.id, enregistrementsVisio.rendezVousId))
    .where(eq(enregistrementsVisio.instanceId, currentInstance))
    .orderBy(desc(enregistrementsVisio.debutAt))
    .limit(limite);
  return lignes.map(({ resume, ...l }) => ({ ...l, aResume: resume !== null }));
}

// Supprime l'enregistrement (et ses morceaux) et l'entrée d'Inbox de son résumé. Le rendez-vous
// créé par un enregistrement libre part avec lui, sauf s'il a un compte rendu, des liens ou un
// autre enregistrement : on ne perd jamais ce que Marc y a ajouté.
export async function supprimerSession(tx: Tx, id: string): Promise<boolean> {
  const [s] = await tx
    .select({ rdv: enregistrementsVisio.rendezVousId })
    .from(enregistrementsVisio)
    .where(
      and(eq(enregistrementsVisio.instanceId, currentInstance), eq(enregistrementsVisio.id, id)),
    );
  if (!s) return false;
  await tx.delete(enregistrementsVisio).where(eq(enregistrementsVisio.id, id));
  await tx
    .delete(sujets)
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.source, 'visio'),
        eq(sujets.sourceId, id),
      ),
    );
  await supprimerRdvLibreVide(tx, s.rdv);
  return true;
}

// Un rendez-vous créé par un enregistrement libre disparaît avec lui, tant que rien d'autre ne s'y
// est accroché (compte rendu, fiches liées, autre enregistrement).
async function supprimerRdvLibreVide(tx: Tx, rdvId: string): Promise<void> {
  const [r] = await tx
    .select({
      source: rendezVous.source,
      compteRendu: rendezVous.compteRendu,
      transcript: rendezVous.transcript,
    })
    .from(rendezVous)
    .where(eq(rendezVous.id, rdvId));
  if (r?.source !== SOURCE_RDV_LIBRE || r.compteRendu !== null || r.transcript !== null) return;
  const { rows } = await tx.execute<{ n: number }>(sql`
    select (select count(*) from rdv_contacts where rendez_vous_id = ${rdvId})
         + (select count(*) from rdv_entreprises where rendez_vous_id = ${rdvId})
         + (select count(*) from rdv_affaires where rendez_vous_id = ${rdvId})
         + (select count(*) from enregistrements_visio where rendez_vous_id = ${rdvId}) as n`);
  const usages = Number(rows[0]?.n ?? 0);
  if (usages === 0) await tx.delete(rendezVous).where(eq(rendezVous.id, rdvId));
}

// Marc rattache l'enregistrement à un autre rendez-vous (existant ou créé pour l'occasion) : le
// rendez-vous libre d'origine, resté vide, est supprimé. Renvoie null si l'un des deux manque.
export async function rattacherSession(
  tx: Tx,
  id: string,
  rdvEventId: string,
): Promise<{ rdvId: string } | null> {
  const [s] = await tx
    .select({ rdv: enregistrementsVisio.rendezVousId })
    .from(enregistrementsVisio)
    .where(
      and(eq(enregistrementsVisio.instanceId, currentInstance), eq(enregistrementsVisio.id, id)),
    );
  const [cible] = await tx
    .select({ id: rendezVous.id })
    .from(rendezVous)
    .where(and(eq(rendezVous.instanceId, currentInstance), eq(rendezVous.eventId, rdvEventId)));
  if (!s || !cible) return null;
  if (s.rdv === cible.id) return { rdvId: rdvEventId };
  await tx
    .update(enregistrementsVisio)
    .set({ rendezVousId: cible.id })
    .where(eq(enregistrementsVisio.id, id));
  await fusionnerRdvLibre(tx, id, s.rdv, cible.id);
  await rangerSujetVisio(tx, id, cible.id);
  await supprimerRdvLibreVide(tx, s.rdv);
  return { rdvId: rdvEventId };
}

export class FusionImpossible extends Error {}

// Marc fusionne l'enregistrement avec un rendez-vous existant : son transcript et son résumé passent
// dans le rendez-vous, puis l'enregistrement disparaît de la liste. Rien n'est écrasé : un transcript
// déjà présent reçoit le nouveau à la suite ; un compte rendu déjà présent reste tel quel (le
// résumé n'est alors pas repris, le transcript l'est). Null si la session ou le rendez-vous manque.
export async function fusionnerSession(
  tx: Tx,
  id: string,
  rdvEventId: string,
): Promise<{ rdvId: string; compteRendu: 'repris' | 'conserve' | 'aucun' } | null> {
  const session = await lireSession(tx, id);
  if (!session) return null;
  if (session.statut !== 'transcrit') {
    throw new FusionImpossible(
      'L’enregistrement n’est pas encore transcrit : patientez un instant.',
    );
  }
  // Rattache d'abord : le contenu du rendez-vous libre d'origine est fusionné au passage.
  const rattache = await rattacherSession(tx, id, rdvEventId);
  if (!rattache) return null;
  const [cible] = await tx
    .select()
    .from(rendezVous)
    .where(and(eq(rendezVous.instanceId, currentInstance), eq(rendezVous.eventId, rdvEventId)));
  if (!cible) return null;
  const net = (t: string | null) => (t ?? '').trim();
  const modifs: {
    compteRendu?: string;
    compteRenduAt?: Date;
    transcript?: string;
    transcriptAt?: Date;
  } = {};

  const texte = net(session.transcript) || assemblerTranscript(session.morceaux);
  if (texte) {
    if (!net(cible.transcript)) modifs.transcript = texte;
    else if (net(cible.transcript) !== texte) {
      const quand = session.debutAt;
      modifs.transcript = `${net(cible.transcript)}\n\n— Enregistrement du ${dateParis(quand)} à ${heureParis(quand)} —\n${texte}`;
    }
    if (modifs.transcript !== undefined) modifs.transcriptAt = new Date();
  }
  let compteRendu: 'repris' | 'conserve' | 'aucun' = 'aucun';
  if (net(session.resume)) {
    if (!net(cible.compteRendu)) {
      modifs.compteRendu = net(session.resume);
      modifs.compteRenduAt = new Date();
      compteRendu = 'repris';
    } else {
      compteRendu = net(cible.compteRendu) === net(session.resume) ? 'repris' : 'conserve';
    }
  }
  if (Object.keys(modifs).length > 0) {
    await tx.update(rendezVous).set(modifs).where(eq(rendezVous.id, cible.id));
  }
  await supprimerSession(tx, id);
  return { rdvId: rdvEventId, compteRendu };
}

// L'entrée d'Inbox du résumé de cette visio se range dans celle du rendez-vous cible, si elle en a
// une ouverte : une réunion, une entrée.
async function rangerSujetVisio(tx: Tx, sessionId: string, cibleId: string): Promise<void> {
  const [s] = await tx
    .select({ resume: enregistrementsVisio.resume })
    .from(enregistrementsVisio)
    .where(eq(enregistrementsVisio.id, sessionId));
  if (!s?.resume || !(await proposerResumeAuSujet(tx, cibleId, s.resume))) return;
  await tx
    .delete(sujets)
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.source, 'visio'),
        eq(sujets.sourceId, sessionId),
        eq(sujets.statut, 'a_traiter'),
      ),
    );
}

// Fusion avec le rendez-vous libre d'origine : son compte rendu et son transcript passent dans le
// rendez-vous cible, sans jamais écraser ce que celui-ci porte déjà. Un texte identique à ce qui
// existe ailleurs (cible, résumé de l'enregistrement) est une simple copie : il n'est pas gardé.
// Un texte différent d'un compte rendu déjà présent reste dans le rendez-vous libre, qui n'est
// alors pas supprimé : rien de ce que Marc a écrit ne se perd.
async function fusionnerRdvLibre(
  tx: Tx,
  sessionId: string,
  libreId: string,
  cibleId: string,
): Promise<void> {
  const lire = async (rdvId: string) => {
    const [r] = await tx.select().from(rendezVous).where(eq(rendezVous.id, rdvId));
    return r;
  };
  const libre = await lire(libreId);
  const cible = await lire(cibleId);
  if (libre?.source !== SOURCE_RDV_LIBRE || !cible) return;
  const [session] = await tx
    .select({ resume: enregistrementsVisio.resume, transcript: enregistrementsVisio.transcript })
    .from(enregistrementsVisio)
    .where(eq(enregistrementsVisio.id, sessionId));
  const net = (t: string | null) => (t ?? '').trim();

  const modifsCible: {
    compteRendu?: string;
    compteRenduAt?: Date;
    transcript?: string;
    transcriptAt?: Date;
  } = {};
  const modifsLibre: {
    compteRendu?: null;
    compteRenduAt?: null;
    transcript?: null;
    transcriptAt?: null;
  } = {};

  if (net(libre.compteRendu)) {
    if (!net(cible.compteRendu)) {
      modifsCible.compteRendu = libre.compteRendu ?? '';
      modifsCible.compteRenduAt = libre.compteRenduAt ?? new Date();
      modifsLibre.compteRendu = null;
      modifsLibre.compteRenduAt = null;
    } else if (
      net(libre.compteRendu) === net(cible.compteRendu) ||
      net(libre.compteRendu) === net(session?.resume ?? null)
    ) {
      modifsLibre.compteRendu = null;
      modifsLibre.compteRenduAt = null;
    }
  } else {
    modifsLibre.compteRendu = null;
    modifsLibre.compteRenduAt = null;
  }
  // Le transcript suit l'enregistrement : le rendez-vous cible reçoit celui de l'enregistrement
  // (ou, à défaut, celui que Marc avait gardé dans le rendez-vous libre) tant qu'il n'en a pas un.
  const transcript = net(libre.transcript) || net(session?.transcript ?? null);
  if (transcript && !net(cible.transcript)) {
    modifsCible.transcript = libre.transcript?.trim()
      ? libre.transcript
      : (session?.transcript ?? '');
    modifsCible.transcriptAt = libre.transcriptAt ?? new Date();
  }
  if (libre.transcript !== null) {
    modifsLibre.transcript = null;
    modifsLibre.transcriptAt = null;
  }
  if (Object.keys(modifsCible).length > 0) {
    await tx.update(rendezVous).set(modifsCible).where(eq(rendezVous.id, cibleId));
  }
  if (Object.keys(modifsLibre).length > 0) {
    await tx.update(rendezVous).set(modifsLibre).where(eq(rendezVous.id, libreId));
  }
}

// Le transcript de la session est copié dans son rendez-vous (qui n'en garde qu'un, le dernier).
export async function garderTranscriptDansRdv(tx: Tx, id: string): Promise<boolean> {
  const s = await lireSession(tx, id);
  const texte = s?.transcript ?? (s ? assemblerTranscript(s.morceaux) : '');
  if (!s || !texte.trim()) return false;
  await tx
    .update(rendezVous)
    .set({ transcript: texte, transcriptAt: new Date() })
    .where(eq(rendezVous.id, s.rendezVousId));
  return true;
}

// Marc corrige le texte transcrit ou le résumé : un résumé vidé est effacé.
export async function modifierSession(
  tx: Tx,
  id: string,
  m: { transcript?: string; resume?: string },
): Promise<boolean> {
  const resume = m.resume === undefined ? undefined : m.resume.trim() || null;
  const modifs = {
    ...(m.transcript === undefined ? {} : { transcript: m.transcript }),
    ...(resume === undefined ? {} : { resume, resumeAt: resume === null ? null : new Date() }),
  };
  if (Object.keys(modifs).length === 0) return (await lireSession(tx, id)) !== null;
  const rows = await tx
    .update(enregistrementsVisio)
    .set(modifs)
    .where(
      and(eq(enregistrementsVisio.instanceId, currentInstance), eq(enregistrementsVisio.id, id)),
    )
    .returning({ id: enregistrementsVisio.id });
  return rows.length > 0;
}
