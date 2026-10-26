import type { PgTable } from 'drizzle-orm/pg-core';
import {
  affaireContacts,
  affaireEntreprises,
  contactEntreprises,
  contacts,
  entreprises,
  opportunites,
  rdvAffaires,
  rdvContacts,
  rdvEntreprises,
  rendezVous,
  taches,
} from '../crm/schema.js';
import { sujets } from '../inbox/schema.js';
import type { TypeObjet } from './types.js';

// `colonne` and the link columns are Drizzle property names, not SQL names.
export type Colonne = { colonne: string; vers: TypeObjet };
// Many-to-many table: `proprietaire` side owns it, both columns are uuids of the linked objects.
export type Liaison = {
  table: PgTable;
  proprietaire: TypeObjet;
  colProprietaire: string;
  cible: TypeObjet;
  colCible: string;
};
export type Entree = {
  table: PgTable;
  libelle: (ligne: Record<string, unknown>) => string;
  liens: Colonne[];
  liaisons: Liaison[];
  // Linked types that follow without a choice; every other linked type is offered.
  obligatoires: TypeObjet[];
  // Links to something that never leaves its instance (proposals): always cut.
  coupes: string[];
};

const texte = (cle: string) => (l: Record<string, unknown>) => String(l[cle] ?? '');

export const REGISTRE: Record<TypeObjet, Entree> = {
  sujet: {
    table: sujets,
    libelle: texte('titre'),
    liens: [
      { colonne: 'contactId', vers: 'contact' },
      { colonne: 'entrepriseId', vers: 'entreprise' },
      { colonne: 'tacheId', vers: 'tache' },
    ],
    liaisons: [],
    obligatoires: [],
    coupes: ['propositionId'],
  },
  tache: {
    table: taches,
    libelle: texte('titre'),
    liens: [
      { colonne: 'opportuniteId', vers: 'affaire' },
      { colonne: 'contactId', vers: 'contact' },
      { colonne: 'entrepriseId', vers: 'entreprise' },
    ],
    liaisons: [],
    obligatoires: [],
    coupes: [],
  },
  affaire: {
    table: opportunites,
    libelle: texte('titre'),
    liens: [
      { colonne: 'entrepriseId', vers: 'entreprise' },
      { colonne: 'contactId', vers: 'contact' },
    ],
    liaisons: [
      {
        table: affaireContacts,
        proprietaire: 'affaire',
        colProprietaire: 'opportuniteId',
        cible: 'contact',
        colCible: 'contactId',
      },
      {
        table: affaireEntreprises,
        proprietaire: 'affaire',
        colProprietaire: 'opportuniteId',
        cible: 'entreprise',
        colCible: 'entrepriseId',
      },
    ],
    obligatoires: ['tache', 'rdv', 'sujet'],
    coupes: [],
  },
  contact: {
    table: contacts,
    libelle: texte('nom'),
    liens: [{ colonne: 'entrepriseId', vers: 'entreprise' }],
    liaisons: [
      {
        table: contactEntreprises,
        proprietaire: 'contact',
        colProprietaire: 'contactId',
        cible: 'entreprise',
        colCible: 'entrepriseId',
      },
    ],
    obligatoires: ['tache', 'rdv', 'sujet'],
    coupes: [],
  },
  entreprise: {
    table: entreprises,
    libelle: texte('nom'),
    liens: [],
    liaisons: [],
    obligatoires: ['tache', 'sujet'],
    coupes: [],
  },
  rdv: {
    table: rendezVous,
    libelle: texte('titre'),
    liens: [],
    liaisons: [
      {
        table: rdvContacts,
        proprietaire: 'rdv',
        colProprietaire: 'rendezVousId',
        cible: 'contact',
        colCible: 'contactId',
      },
      {
        table: rdvEntreprises,
        proprietaire: 'rdv',
        colProprietaire: 'rendezVousId',
        cible: 'entreprise',
        colCible: 'entrepriseId',
      },
      {
        table: rdvAffaires,
        proprietaire: 'rdv',
        colProprietaire: 'rendezVousId',
        cible: 'affaire',
        colCible: 'opportuniteId',
      },
    ],
    obligatoires: [],
    coupes: [],
  },
};

// Activities follow their object: the column of `activites` pointing at it.
export const ACTIVITES_DE = {
  affaire: 'opportuniteId',
  contact: 'contactId',
  entreprise: 'entrepriseId',
} as const;
