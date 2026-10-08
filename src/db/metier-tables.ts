import { contacts, entreprises } from '../crm/schema.js';

// Every business table, children before parents (purge order). Each new business table goes here.
export const METIER_TABLES = [contacts, entreprises] as const;
