import { connexions } from '../connexions/schema.js';
import { contacts, entreprises } from '../crm/schema.js';
import { autonomie, propositions } from '../propositions/schema.js';

// Every business table, children before parents (purge order). Each new business table goes here.
export const METIER_TABLES = [connexions, propositions, autonomie, contacts, entreprises] as const;
