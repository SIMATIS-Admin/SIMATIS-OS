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
import { echangesAjout, reunionsWispr, sujets } from '../inbox/schema.js';
import {
  donneesEnvoyees,
  missions,
  partenaires,
  relaisSorties,
  relaisVus,
} from '../partenaires/schema.js';

// Every business table, children before parents (purge order). Each new business table goes here.
export const METIER_TABLES = [
  baseReponses,
  baseLignesBrutes,
  baseVivante,
  baseImports,
  baseCorrespondances,
  echangesAjout,
  relaisVus,
  relaisSorties,
  donneesEnvoyees,
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
  activites,
  taches,
  opportunites,
  contacts,
  entreprises,
] as const;
