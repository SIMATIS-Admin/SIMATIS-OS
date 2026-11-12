import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { sujets } from './schema.js';

// La routine rédige le compte rendu d'une réunion : il est rattaché à l'entrée « compte rendu » et
// remplit son champ. Une entrée d'un autre type, déjà traitée ou d'un autre espace reste intacte :
// « introuvable ». Un nouveau brouillon remplace le précédent.
export async function preparerCompteRendu(
  tx: Tx,
  sujetId: string,
  texte: string,
): Promise<{ statut: 'enregistree' | 'introuvable' }> {
  const [maj] = await tx
    .update(sujets)
    .set({
      compteRenduPrepare: { texte, prepareeLe: new Date().toISOString() },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.id, sujetId),
        eq(sujets.type, 'compte_rendu'),
        eq(sujets.statut, 'a_traiter'),
      ),
    )
    .returning({ id: sujets.id });
  return { statut: maj ? 'enregistree' : 'introuvable' };
}
