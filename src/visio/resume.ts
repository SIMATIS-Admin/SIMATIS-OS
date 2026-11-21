import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { rendezVous } from '../crm/schema.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { deposerSujet } from '../inbox/depot.js';
import { construireDossier } from '../inbox/dossier-rdv.js';
import { sujets } from '../inbox/schema.js';
import { proposerResumeAuSujet } from '../inbox/sujet-rdv.js';
import { construireSuite } from '../inbox/suite-rdv.js';
import type { SuiteAnnoncee } from '../inbox/schema.js';
import type { Instance } from '../instances/schema.js';
import { enregistrementsVisio } from './schema.js';

const PAR_PASSAGE = 3;
// Au-delà, le résumé n'est plus un résumé ; l'entrée d'Inbox n'en montre que le début.
export const RESUME_MAX = 20_000;
const EXTRAIT_INBOX = 2_000;

// Visios transcrites que personne n'a encore résumées. Une visio sans parole transcrite n'a rien à résumer.
export async function sessionsAResumer(tx: Tx) {
  return tx
    .select({
      id: enregistrementsVisio.id,
      rendezVousId: enregistrementsVisio.rendezVousId,
      titre: rendezVous.titre,
      transcript: enregistrementsVisio.transcript,
      debut: enregistrementsVisio.debutAt,
      finEnregistrement: enregistrementsVisio.finAt,
      finRendezVous: rendezVous.fin,
      participants: rendezVous.participants,
    })
    .from(enregistrementsVisio)
    .innerJoin(rendezVous, eq(rendezVous.id, enregistrementsVisio.rendezVousId))
    .where(
      and(
        eq(enregistrementsVisio.instanceId, currentInstance),
        eq(enregistrementsVisio.statut, 'transcrit'),
        isNull(enregistrementsVisio.resume),
        isNotNull(enregistrementsVisio.transcript),
        ne(enregistrementsVisio.transcript, ''),
      ),
    )
    .limit(PAR_PASSAGE);
}

// Enregistre le résumé et le dépose dans l'Inbox (une seule entrée par visio, même si l'exécuteur
// rend deux fois son résultat). Marc le relit, puis en fait le compte rendu du rendez-vous.
export async function poserResume(
  tx: Tx,
  id: string,
  resume: string,
  suite?: { instance: Instance; annoncee: SuiteAnnoncee },
): Promise<boolean> {
  const [s] = await tx
    .update(enregistrementsVisio)
    .set({ resume, resumeAt: new Date() })
    .where(
      and(
        eq(enregistrementsVisio.instanceId, currentInstance),
        eq(enregistrementsVisio.id, id),
        eq(enregistrementsVisio.statut, 'transcrit'),
      ),
    )
    .returning({ rendezVousId: enregistrementsVisio.rendezVousId });
  if (!s) return false;
  const [r] = await tx
    .select({
      titre: rendezVous.titre,
      participants: rendezVous.participants,
      debut: rendezVous.debut,
    })
    .from(rendezVous)
    .where(and(eq(rendezVous.instanceId, currentInstance), eq(rendezVous.id, s.rendezVousId)));
  const [session] = await tx
    .select({ debutAt: enregistrementsVisio.debutAt })
    .from(enregistrementsVisio)
    .where(
      and(eq(enregistrementsVisio.instanceId, currentInstance), eq(enregistrementsVisio.id, id)),
    );
  const dossier = await construireDossier(tx, {
    sessionVisioId: id,
    rdvId: s.rendezVousId,
    debutAt: session?.debutAt ?? r?.debut ?? new Date(),
    participants: r?.participants ?? [],
  });
  if (suite) {
    const lignes = await construireSuite(tx, { ...suite, dossier });
    if (lignes.length > 0) dossier.suite = lignes;
  }
  // Le rendez-vous a déjà son entrée « compte rendu » (agenda) : le résumé s'y range, sans doublon.
  if (await proposerResumeAuSujet(tx, s.rendezVousId, resume, dossier)) return true;
  const { id: sujetId } = await deposerSujet(tx, {
    type: 'compte_rendu',
    titre: `Résumé de la visio : ${r?.titre ?? 'rendez-vous'}`.slice(0, 300),
    resume: resume.slice(0, EXTRAIT_INBOX),
    origine: 'os',
    source: 'visio',
    sourceId: id,
    contactId: dossier.interlocuteurs.find((i) => i.principal)?.contactId ?? null,
  });
  // Le texte complet et le dossier remplissent l'entrée ; un second dépôt du même résultat ne
  // remplace ni le texte ni les corrections déjà faites.
  await tx
    .update(sujets)
    .set({
      compteRenduPrepare: { texte: resume, prepareeLe: new Date().toISOString(), dossier },
      updatedAt: new Date(),
    })
    .where(and(eq(sujets.id, sujetId), sql`${sujets.compteRenduPrepare} is null`));
  return true;
}
