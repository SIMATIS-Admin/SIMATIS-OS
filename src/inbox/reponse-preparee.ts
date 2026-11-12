import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { SujetInvalide } from './depot.js';
import { sujets } from './schema.js';

export type ReponseAPreparer = {
  objet?: string | null;
  texte: string;
  lienBrouillon?: string | null;
};

// La routine attache sa réponse rédigée au sujet qu'elle a déposé sous la même clé. Un sujet déjà
// traité, inconnu ou d'un autre espace reste intact : « introuvable ». Une nouvelle réponse remplace
// la précédente.
export async function preparerReponse(
  tx: Tx,
  cle: string,
  reponse: ReponseAPreparer,
): Promise<{ statut: 'enregistree' | 'introuvable' }> {
  // Le lien s'ouvre par un clic dans l'OS : une adresse web seulement, jamais javascript: ou data:.
  if (reponse.lienBrouillon && !/^https?:\/\//i.test(reponse.lienBrouillon)) {
    throw new SujetInvalide('Lien invalide : une adresse web (http ou https) est attendue');
  }
  const [maj] = await tx
    .update(sujets)
    .set({
      reponsePreparee: {
        objet: reponse.objet ?? null,
        texte: reponse.texte,
        lienBrouillon: reponse.lienBrouillon ?? null,
        prepareeLe: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.source, 'routine'),
        eq(sujets.sourceId, cle),
        eq(sujets.statut, 'a_traiter'),
      ),
    )
    .returning({ id: sujets.id });
  return { statut: maj ? 'enregistree' : 'introuvable' };
}
