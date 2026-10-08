import { connexions } from '../connexions/schema.js';
import { activites, contacts, entreprises, opportunites, taches } from '../crm/schema.js';
import { autonomie, propositions } from '../propositions/schema.js';

// Every business table, children before parents (purge order). Each new business table goes here.
export const METIER_TABLES = [
  connexions,
  propositions,
  autonomie,
  activites,
  taches,
  opportunites,
  contacts,
  entreprises,
] as const;
