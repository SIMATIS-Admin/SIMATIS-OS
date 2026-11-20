import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { rendezVous } from '../crm/schema.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { deposerSujet } from '../inbox/depot.js';
import { proposerResumeAuSujet } from '../inbox/sujet-rdv.js';
import { enregistrementsVisio } from './schema.js';

const PAR_PASSAGE = 3;
// Au-delà, le résumé n'est plus un résumé ; l'entrée d'Inbox n'en montre que le début.
export const RESUME_MAX = 10_000;
const EXTRAIT_INBOX = 2_000;

// Visios transcrites que personne n'a encore résumées. Une visio sans parole transcrite n'a rien à résumer.
export async function sessionsAResumer(tx: Tx) {
  return tx
    .select({
      id: enregistrementsVisio.id,
      titre: rendezVous.titre,
      transcript: enregistrementsVisio.transcript,
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
export async function poserResume(tx: Tx, id: string, resume: string): Promise<boolean> {
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
    .select({ titre: rendezVous.titre })
    .from(rendezVous)
    .where(and(eq(rendezVous.instanceId, currentInstance), eq(rendezVous.id, s.rendezVousId)));
  // Le rendez-vous a déjà son entrée « compte rendu » (agenda) : le résumé s'y range, sans doublon.
  if (await proposerResumeAuSujet(tx, s.rendezVousId, resume)) return true;
  await deposerSujet(tx, {
    type: 'compte_rendu',
    titre: `Résumé de la visio : ${r?.titre ?? 'rendez-vous'}`.slice(0, 300),
    resume: resume.slice(0, EXTRAIT_INBOX),
    origine: 'os',
    source: 'visio',
    sourceId: id,
  });
  return true;
}
