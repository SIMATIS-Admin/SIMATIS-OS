import { baseVivante } from '../src/base-vivante/schema.js';
import type { Database } from '../src/db.js';

// Fiche fictive de la base vivante pour les tests des autres modules. Hors de src/ : la règle
// « seul integration.ts écrit dans base_vivante » ne surveille que le code de l'application.
export async function insererFiche(
  db: Database,
  valeurs: typeof baseVivante.$inferInsert,
): Promise<string> {
  const [r] = await db.insert(baseVivante).values(valeurs).returning({ id: baseVivante.id });
  if (!r) throw new Error('Fiche non créée');
  return r.id;
}
