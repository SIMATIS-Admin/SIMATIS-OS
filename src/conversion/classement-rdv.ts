import { and, eq, inArray } from 'drizzle-orm';
import type { Evenement } from '../connecteurs/google/google.js';
import { contactsParEmails } from '../crm/emails.js';
import { rendezVous } from '../crm/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import type { StatutRdv } from './rdv.js';

const MIN_MS = 15 * 60_000;
const MAX_MS = 2 * 60 * 60_000;

// Classement automatique d'un événement de l'agenda (spec du 14 novembre 2026). `a_trier` veut dire
// « à confirmer » : le doute reste à Marc. Le premier cas qui s'applique l'emporte.
export function classerEvenement(
  e: Pick<Evenement, 'journee' | 'participants' | 'debut' | 'fin' | 'recurrent' | 'visio'>,
  contactConnu: boolean,
): StatutRdv {
  // Une journée entière, une série qui se répète (pas de compte rendu à chaque fois) ou un bloc
  // sans invité ni visio : de l'organisation.
  if (e.journee || e.recurrent) return 'ignore';
  if (e.participants.length === 0 && !e.visio) return 'ignore';
  const duree = e.fin.getTime() - e.debut.getTime();
  if (e.participants.length > 0 && duree >= MIN_MS && duree <= MAX_MS && (contactConnu || e.visio))
    return 'rdv';
  return 'a_trier';
}

// Le statut de chaque événement pour l'Agenda, en lecture seule : le choix de Marc quand il existe,
// sinon ce que le classement automatique en dirait. Rien n'est écrit ici.
export async function statutsAgenda(
  db: Executor,
  instance: Instance,
  liste: Evenement[],
): Promise<Map<string, StatutRdv>> {
  if (liste.length === 0) return new Map();
  return withInstance(db, instance.id, async (tx) => {
    const gardes = await tx
      .select({ eventId: rendezVous.eventId, statut: rendezVous.statut, tri: rendezVous.tri })
      .from(rendezVous)
      .where(
        and(
          eq(rendezVous.instanceId, currentInstance),
          inArray(
            rendezVous.eventId,
            liste.map((e) => e.id),
          ),
        ),
      );
    const manuels = new Map(gardes.filter((g) => g.tri === 'manuel').map((g) => [g.eventId, g]));
    const connus = await contactsParEmails(tx, [...new Set(liste.flatMap((e) => e.participants))]);
    return new Map(
      liste.map((e) => [
        e.id,
        (manuels.get(e.id)?.statut as StatutRdv | undefined) ??
          classerEvenement(
            e,
            e.participants.some((p) => connus.has(p.toLowerCase())),
          ),
      ]),
    );
  });
}
