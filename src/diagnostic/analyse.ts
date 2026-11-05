import { eq } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { diagnosticProjets } from './schema.js';
import type { ProjetVue } from './service.js';

// Début du message qui lance la capitalisation des règles à partir de la revue validée.
export const DEBUT_MESSAGE_REGLES_ANALYSE = 'Capitaliser l’analyse validée';

// Claude compare ses propositions aux choix du pilote dans la revue validée et aux revues validées
// précédentes, met à jour la fiche des règles d'analyse et déclare ses changements au journal.
export function demanderCapitalisationAnalyse(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<ProjetVue> {
  return envoyerMessage(db, instance, id, `${DEBUT_MESSAGE_REGLES_ANALYSE}.`, {
    type: 'regles_analyse',
    etape: 3,
    verifier: (projet) => {
      if (projet.revue?.statut !== 'validée')
        throw new ChatIndisponible("Validez d'abord la revue à l'étape 3.");
    },
  });
}

// Une capitalisation par validation : ni une modification de la revue, ni une revue qui reste validée.
export const revueVientDEtreValidee = (avant: unknown, apres: unknown): boolean =>
  apres === 'validée' && avant !== 'validée';

// Statut de la revue avant une mise à jour, pour savoir si cette mise à jour la valide.
export async function statutRevueDe(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<string | null> {
  return withInstance(db, instance.id, async (tx) => {
    const [projet] = await tx
      .select({ revue: diagnosticProjets.revue })
      .from(diagnosticProjets)
      .where(eq(diagnosticProjets.id, id));
    const statut = projet?.revue?.statut;
    return typeof statut === 'string' ? statut : null;
  });
}
