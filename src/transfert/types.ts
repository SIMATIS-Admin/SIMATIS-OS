export type TypeObjet = 'sujet' | 'tache' | 'affaire' | 'contact' | 'entreprise' | 'rdv';
export type Mode = 'deplace' | 'copie';

export type Noeud = {
  type: TypeObjet;
  id: string;
  libelle: string;
  mode: Mode;
  // Follows its parent without a choice; the others are offered and can be unticked.
  obligatoire: boolean;
};

export type Ref = { type: TypeObjet; id: string };
export type Exclusions = Ref[];

export type Apercu = {
  racine: Noeud;
  noeuds: Noeud[];
  liensRetires: string[];
  avertissements: string[];
  copieExistante: Ref | null;
};

export type Utilisateur = { roles: string[] };
