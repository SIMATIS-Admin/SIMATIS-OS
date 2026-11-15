import type { Database } from '../../db.js';
import type { LimitesIA } from '../limites.js';
import { iaJauges } from './schema.js';

// Le fichier des jauges est écrasé à chaque relevé du collecteur : on en garde l'historique ici,
// pour convertir les jetons en points de jauge et mesurer le « non attribué ».
export async function noterJauges(db: Database, limites: LimitesIA): Promise<number> {
  if (!limites.actualiseLe) return 0;
  const at = new Date(limites.actualiseLe);
  const lignes = limites.fournisseurs.flatMap((f) =>
    f.etat === 'ok' && f.fenetre5h && f.hebdomadaire
      ? [
          {
            fournisseur: f.id,
            at,
            source: 'collecteur' as const,
            utilise5h: 100 - f.fenetre5h.restant,
            utiliseHebdo: 100 - f.hebdomadaire.restant,
            reset5h: new Date(f.fenetre5h.reinitialiseLe),
            resetHebdo: new Date(f.hebdomadaire.reinitialiseLe),
          },
        ]
      : [],
  );
  if (lignes.length === 0) return 0;
  const inserees = await db
    .insert(iaJauges)
    .values(lignes)
    .onConflictDoNothing()
    .returning({ at: iaJauges.at });
  return inserees.length;
}
