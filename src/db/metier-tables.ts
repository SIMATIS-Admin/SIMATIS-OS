import { connexions } from '../connexions/schema.js';
import { devis } from '../conversion/schema.js';
import { executions, routines } from '../routines/schema.js';
import { activites, contacts, entreprises, opportunites, taches } from '../crm/schema.js';
import { autonomie, propositions } from '../propositions/schema.js';
import {
  baseCorrespondances,
  baseReponses,
  baseImports,
  baseLignesBrutes,
  baseVivante,
} from '../base-vivante/schema.js';
import {
  gestionCcaMouvements,
  gestionDepenseExceptions,
  gestionDepenses,
  gestionIkBaremes,
  gestionIkLieux,
  gestionIkMois,
  gestionIkTrajets,
  gestionIkVehicules,
  gestionReglages,
  gestionRevenuExceptions,
  gestionRevenus,
  gestionTvaMois,
} from '../gestion/schema.js';
import { echangesAjout, reunionsWispr, sujets } from '../inbox/schema.js';
import {
  crmPartages,
  invitationsPartenaires,
  messagesPartenaires,
  missions,
  partenaires,
  relaisSorties,
  relaisVus,
} from '../partenaires/schema.js';
import {
  prospectionBrouillons,
  prospectionCampagnes,
  prospectionOccurrences,
  prospectionReglages,
  prospectionSignatures,
  prospectionSuiviFroid,
} from '../prospection/schema.js';
import {
  enrichissementLignes,
  enrichissementSuggestions,
  enrichissementTaches,
} from '../enrichissement/schema.js';

// Every business table, children before parents (purge order). Each new business table goes here.
export const METIER_TABLES = [
  enrichissementSuggestions,
  enrichissementLignes,
  enrichissementTaches,
  gestionCcaMouvements,
  gestionIkTrajets,
  gestionIkVehicules,
  gestionIkBaremes,
  gestionIkLieux,
  gestionIkMois,
  gestionTvaMois,
  gestionReglages,
  gestionDepenseExceptions,
  gestionRevenuExceptions,
  gestionRevenus,
  gestionDepenses,
  baseReponses,
  baseLignesBrutes,
  baseVivante,
  baseImports,
  baseCorrespondances,
  echangesAjout,
  relaisVus,
  relaisSorties,
  crmPartages,
  invitationsPartenaires,
  messagesPartenaires,
  missions,
  partenaires,
  reunionsWispr,
  sujets,
  connexions,
  executions,
  routines,
  devis,
  propositions,
  autonomie,
  prospectionBrouillons,
  prospectionCampagnes,
  prospectionOccurrences,
  prospectionSignatures,
  prospectionReglages,
  prospectionSuiviFroid,
  activites,
  taches,
  opportunites,
  contacts,
  entreprises,
] as const;
