import type { Evenement } from '../connecteurs/google/google.js';
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
