import type { InstanceSummary } from './nav.js';

export type Entreprise = {
  id: string;
  nom: string;
  secteur: string | null;
  ville: string | null;
  taille: number | null;
  domaine: string | null;
  nbContacts: number;
  oppsOuvertes: number;
  montantOuvert: number;
};

export type OppLigne = {
  id: string;
  titre: string;
  etape: string;
  montant: number | null;
  echeance: string | null;
  clos: 'gagne' | 'perdu' | null;
  motif: string | null;
};

export type FicheEntreprise = Omit<Entreprise, 'nbContacts'> & {
  contacts: { id: string; nom: string; fonction: string | null; role: string | null }[];
  opportunites: OppLigne[];
};

export type FicheContact = {
  id: string;
  nom: string;
  fonction: string | null;
  email: string | null;
  telephone: string | null;
  role: string | null;
  entreprise: { id: string; nom: string } | null;
  opportunites: OppLigne[];
  taches: { id: string; titre: string; canal: string; echeance: string | null }[];
};

export type Contact = {
  id: string;
  nom: string;
  fonction: string | null;
  email: string | null;
  role: string | null;
  entreprise: string | null;
  entrepriseId: string | null;
};

export type JournalEntry = {
  id: number;
  at: string;
  acteur: string;
  action: string;
  niveau: string | null;
};

export type InstanceFiche = InstanceSummary & {
  statut: 'actif' | 'archive';
  ecrituresReelles: boolean;
  creeeLe: string;
};

export type PortefeuilleLigne = {
  slug: string;
  nom: string;
  type: InstanceSummary['type'];
  aValider: number;
  tachesEnRetard: number | null;
  rdv7j: number | null;
  routinesActives: number | null;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Erreur ${response.status} sur ${url}`);
  return body as T;
}
const getJson = <T>(url: string) => request<T>(url);
const sendJson = <T>(method: 'PUT' | 'PATCH' | 'POST', url: string, payload: unknown) =>
  request<T>(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

const inst = (slug: string, path: string) => `/api/i/${encodeURIComponent(slug)}/${path}`;

export const fetchJournal = (slug: string) => getJson<JournalEntry[]>(inst(slug, 'journal'));
export const fetchInstanceFiche = (slug: string) => getJson<InstanceFiche>(inst(slug, 'instance'));
export const renameInstance = (slug: string, nom: string) =>
  sendJson<InstanceSummary>('PATCH', inst(slug, 'instance'), { nom });
export const creerProspect = (nom: string) =>
  sendJson<InstanceSummary>('POST', '/api/prospects', { nom });
export const reinitialiserDemo = (slug: string) =>
  sendJson<{ ok: true }>('POST', inst(slug, 'demo/reinitialiser'), {});
export const convertirProspect = (slug: string, crm: 'hubspot' | null) =>
  sendJson<InstanceSummary>('POST', inst(slug, 'convertir'), { crm });
export const fetchPortefeuille = () => getJson<PortefeuilleLigne[]>('/api/portefeuille');
export const fetchFavoris = async () =>
  (await getJson<{ favoris: string[] }>('/api/preferences')).favoris;
export const saveFavoris = async (favoris: string[]) =>
  (await sendJson<{ favoris: string[] }>('PUT', '/api/preferences', { favoris })).favoris;

export const fetchInstances = () => getJson<InstanceSummary[]>('/api/instances');

export const fetchEntreprises = (slug: string, q: string) =>
  getJson<Entreprise[]>(
    `/api/i/${encodeURIComponent(slug)}/entreprises?q=${encodeURIComponent(q)}`,
  );

export const fetchContacts = (slug: string, q: string) =>
  getJson<Contact[]>(`/api/i/${encodeURIComponent(slug)}/contacts?q=${encodeURIComponent(q)}`);

export const fetchEntreprise = (slug: string, id: string) =>
  getJson<FicheEntreprise>(inst(slug, `entreprises/${encodeURIComponent(id)}`));
export const fetchContact = (slug: string, id: string) =>
  getJson<FicheContact>(inst(slug, `contacts/${encodeURIComponent(id)}`));
export const createEntreprise = (
  slug: string,
  input: { nom: string; secteur?: string; ville?: string },
) => sendJson<{ id: string }>('POST', inst(slug, 'entreprises'), input);
export const createContact = (
  slug: string,
  input: { nom: string; fonction?: string; email?: string; entrepriseId?: string | null },
) => sendJson<{ id: string }>('POST', inst(slug, 'contacts'), input);

export type ReglagesCrm = {
  frequence?: '5min' | '15min' | '1h' | '1j' | 'manuel';
  sens?: 'deux_sens' | 'lecture';
  objets?: string[];
  champsExclus?: string[];
  domainesExclus?: string[];
};

export type ConnexionInfo = {
  kind: 'crm' | 'messagerie' | 'agenda';
  fournisseur: string;
  etat: 'ok' | 'non_configuree' | 'erreur';
  reglages: ReglagesCrm & Record<string, unknown>;
  derniereSynchro: string | null;
  derniereErreur: string | null;
  secret: { nom: string; present: boolean } | null;
};

export type ConnexionsReponse = {
  connexions: ConnexionInfo[];
  options: { objets: string[]; champs: { cle: string; libelle: string }[] };
  googleClientDisponible: boolean;
  ecrituresReelles: boolean;
};

export const fetchConnexions = (slug: string) =>
  getJson<ConnexionsReponse>(inst(slug, 'connexions'));
export const saveReglagesCrm = (slug: string, reglages: ReglagesCrm) =>
  sendJson<{ reglages: ReglagesCrm }>('PATCH', inst(slug, 'connexions/crm'), reglages);
export const saveReglages = (
  slug: string,
  kind: 'messagerie' | 'agenda',
  reglages: Record<string, unknown>,
) =>
  sendJson<{ reglages: Record<string, unknown> }>(
    'PATCH',
    inst(slug, `connexions/${kind}`),
    reglages,
  );
export const brancherHubspot = (slug: string, token: string) =>
  sendJson<{ ok: true }>('POST', inst(slug, 'connexions/hubspot'), { token });
export const enregistrerSecretGoogle = (secret: string) =>
  sendJson<{ ok: true }>('PUT', '/api/google/secret', { secret });
export const demarrerGoogle = (slug: string) =>
  sendJson<{ url: string }>('POST', inst(slug, 'connexions/google/start'), {});
export const syncConnexion = (slug: string, kind: string) =>
  sendJson<{ lus: number; crees: number; maj: number }>(
    'POST',
    inst(slug, `connexions/${encodeURIComponent(kind)}/sync`),
    {},
  );

export type Qualification = {
  besoin: number;
  decideur: number;
  budget: number;
  timing: number;
  engagement: number;
};

export type PipelineOpp = {
  id: string;
  titre: string;
  etape: string;
  clos: 'gagne' | 'perdu' | null;
  motif: string | null;
  montant: number | null;
  echeance: string | null;
  qualification: Qualification | null;
  potentiel: string | null;
  faisabilite: string | null;
  prochaineEtape: string | null;
  entreprise: string | null;
  contact: string | null;
};

export type Pipeline = {
  source: 'natif' | 'hubspot';
  ecrit: boolean;
  derniereSynchro: string | null;
  etapes: { id: string; label: string }[];
  conversions: (number | null)[];
  opportunites: PipelineOpp[];
};

export type Changement =
  { etape: string } | { clos: 'gagne' | 'perdu'; motif?: string | null } | { rouvrir: true };

export const fetchPipeline = (slug: string) => getJson<Pipeline>(inst(slug, 'pipeline'));
export const changeOpportunite = (slug: string, id: string, change: Changement) =>
  sendJson<{ opportunite: PipelineOpp; simulation: boolean }>(
    'PATCH',
    inst(slug, `opportunites/${encodeURIComponent(id)}`),
    change,
  );

export type Compte = { email: number; appel: number; autre: number; total: number };
export type BriefTache = {
  id: string;
  titre: string;
  canal: 'email' | 'appel' | 'tache';
  echeance: string | null;
  prepare: boolean;
  source: string;
  contact: string | null;
  entreprise: string | null;
  opportunite: string | null;
  situation: 'retard' | 'jour';
};
export type Brief = {
  source: 'hubspot' | 'natif';
  rdv: { debut: string; fin: string; titre: string; lieu: string | null }[];
  rdvEtat: 'ok' | 'non_configure' | 'erreur';
  rdvErreur?: string;
  taches: BriefTache[];
  realisees: {
    veille: Compte & { jour: string };
    semaine: Compte;
    mois: Compte;
    aujourdhui: Compte;
  };
};

export type PropositionItem = {
  id: string;
  // email.brouillon, crm.tache, note.second_cerveau, or a type added later.
  type: string;
  contenu: Record<string, unknown>;
  auteur: string;
  statut: 'proposee' | 'validee' | 'modifiee' | 'ecartee' | 'appliquee' | 'echec';
  niveau: string;
  decidePar: string | null;
  resultat: unknown;
  createdAt: string;
  action: string | null;
  contact: { id: string; nom: string; entreprise: string | null } | null;
};

export const fetchBrief = (slug: string) => getJson<Brief>(inst(slug, 'brief'));
export const marquerFait = (slug: string, id: string) =>
  sendJson<{ simulation: boolean }>(
    'POST',
    inst(slug, `taches/${encodeURIComponent(id)}/fait`),
    {},
  );
export const fetchPropositions = (slug: string, filtre: string) =>
  getJson<PropositionItem[]>(inst(slug, `propositions?filtre=${encodeURIComponent(filtre)}`));
export const decider = (
  slug: string,
  id: string,
  decision: 'valider' | 'ecarter',
  contenu?: Record<string, unknown>,
) =>
  sendJson<PropositionItem>('POST', inst(slug, `propositions/${encodeURIComponent(id)}/decision`), {
    decision,
    ...(contenu ? { contenu } : {}),
  });

export type Funnel = {
  leads: number;
  l2p: number;
  p2d: number;
  d2c: number;
  panier: number;
  objectif: number;
};
export type Simulation = {
  prospects: number;
  devis: number;
  commandes: number;
  caAnnuel: number;
  leadsNecessaires: number;
  objectifTenu: boolean;
};
export type TableauReponse = {
  pipeline: { montant: number; nombre: number };
  chaudes: { montant: number; nombre: number };
  derniereCampagne: { reponses: number; brouillons: number; rdv: number } | null;
  funnel: Funnel;
  simulation: Simulation;
};
export const fetchTableau = (slug: string) => getJson<TableauReponse>(inst(slug, 'tableau'));
export const saveFunnel = (slug: string, patch: Partial<Funnel>) =>
  sendJson<{ funnel: Funnel; simulation: Simulation }>('PATCH', inst(slug, 'funnel'), patch);

export type RendezVous = {
  id: string;
  debut: string;
  fin: string;
  titre: string;
  lieu: string | null;
  contact: { id: string; nom: string; entreprise: string | null } | null;
  opportunite: { id: string; titre: string } | null;
  compteRendu: boolean;
};
export type RendezVousReponse = {
  etat: 'ok' | 'non_configure' | 'erreur';
  erreur?: string;
  rdv: RendezVous[];
};
export type Preparation = {
  titre: string;
  entreprise: string | null;
  secteur: string | null;
  ville: string | null;
  taille: number | null;
  contact: string | null;
  fonction: string | null;
  role: string | null;
  prochaineEtape: string | null;
  score: number | null;
  aCreuser: { critere: string; note: number | null; question: string | null }[];
};
export const fetchRendezVous = (slug: string) =>
  getJson<RendezVousReponse>(inst(slug, 'rendez-vous'));
export const fetchPreparation = (slug: string, opportuniteId: string) =>
  getJson<Preparation>(inst(slug, `opportunites/${encodeURIComponent(opportuniteId)}/preparation`));
export const envoyerCompteRendu = (slug: string, rdv: RendezVous, texte: string) =>
  sendJson<{ id: string; statut: string }>(
    'POST',
    inst(slug, `rendez-vous/${encodeURIComponent(rdv.id)}/compte-rendu`),
    {
      titre: rdv.titre,
      texte,
      contactId: rdv.contact?.id ?? null,
      opportuniteId: rdv.opportunite?.id ?? null,
    },
  );

export type LigneDevis = { libelle: string; quantite: number; prixUnitaire: number | null };
export type DevisItem = {
  id: string;
  numero: string;
  statut: 'brouillon' | 'valide' | 'transmis';
  lignes: LigneDevis[];
  envoyeLe: string | null;
  validite: string | null;
  opportunite: string;
  entreprise: string | null;
  total: number;
  prixManquant: boolean;
};
export const fetchDevis = (slug: string) => getJson<DevisItem[]>(inst(slug, 'devis'));
export const preparerDevis = (slug: string, opportuniteId: string) =>
  sendJson<{ id: string }>('POST', inst(slug, 'devis'), { opportuniteId });
export const saveLignesDevis = (slug: string, id: string, lignes: LigneDevis[]) =>
  sendJson<{ id: string }>('PATCH', inst(slug, `devis/${encodeURIComponent(id)}`), { lignes });
export const validerDevis = (slug: string, id: string) =>
  sendJson<{ id: string }>('POST', inst(slug, `devis/${encodeURIComponent(id)}/valider`), {});
export const transmettreDevis = (slug: string, id: string) =>
  sendJson<{ id: string }>('POST', inst(slug, `devis/${encodeURIComponent(id)}/transmettre`), {});

export type Rapport = { fait: string[]; attente: string[]; echec: string[] };
export type Execution = {
  id: string;
  routine: string;
  statut: 'demandee' | 'en_cours' | 'terminee' | 'echouee';
  demandePar: string;
  debut: string | null;
  fin: string | null;
  createdAt: string;
  etapes: { etape: string; statut: 'en_cours' | 'fait' | 'echec'; at: string }[];
  rapport: Rapport | null;
};
export type RoutineInfo = {
  cle: string;
  nom: string;
  etapes: string[];
  skill: string;
  actif: boolean;
  params: Record<string, unknown>;
  rythme: string;
  derniere: Execution | null;
};
export const fetchRoutines = (slug: string) => getJson<RoutineInfo[]>(inst(slug, 'routines'));
export const saveRoutine = (
  slug: string,
  cle: string,
  change: { actif?: boolean; params?: Record<string, unknown> },
) => sendJson<RoutineInfo>('PATCH', inst(slug, `routines/${encodeURIComponent(cle)}`), change);
export const lancerRoutine = (slug: string, cle: string) =>
  sendJson<Execution>('POST', inst(slug, `routines/${encodeURIComponent(cle)}/executions`), {});
export const fetchExecution = (slug: string, id: string) =>
  getJson<Execution>(inst(slug, `executions/${encodeURIComponent(id)}`));
