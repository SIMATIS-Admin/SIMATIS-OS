import { fusionnerFiches, supprimerFiches, type KindFiche } from '../../api.js';
import type { BilanSuppression } from './Tableau.js';

// Adapts the bulk routes to what the list component expects.
export const supprimerEnLot =
  (slug: string, kind: KindFiche, apres: () => void) =>
  async (ids: string[]): Promise<BilanSuppression> => {
    const { resultats } = await supprimerFiches(slug, kind, ids);
    apres();
    return {
      ok: resultats.filter((r) => r.ok).length,
      erreurs: resultats.filter((r) => r.erreur).map((r) => ({ id: r.id, erreur: r.erreur ?? '' })),
      simulation: resultats.some((r) => r.simulation),
    };
  };

export const fusionnerDeux =
  (slug: string, kind: KindFiche, apres: () => void) =>
  async (gardeId: string, absorbeId: string) => {
    const r = await fusionnerFiches(slug, kind, gardeId, absorbeId);
    apres();
    return { simulation: 'simulation' in r };
  };
