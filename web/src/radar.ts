import type { PipelineOpp } from './api.js';

// Étape de l'affaire dans le Radar (0 à contacter, 1 approchée, 2 à relancer, 3 a répondu) : le
// placement manuel prime, sinon il se déduit des tentatives et des réponses.
export const etapeRadar = (affaire: PipelineOpp) =>
  Number.isInteger(affaire.radarEtapeManuelle) &&
  affaire.radarEtapeManuelle !== null &&
  affaire.radarEtapeManuelle >= 0 &&
  affaire.radarEtapeManuelle <= 3
    ? affaire.radarEtapeManuelle
    : affaire.radar === 'repondu'
      ? 3
      : (affaire.tentatives ?? 0) >= 3
        ? 2
        : (affaire.tentatives ?? 0) > 0
          ? 1
          : 0;
