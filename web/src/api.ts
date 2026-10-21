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
  prochaineActivite: string | null;
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
  telephone: string | null;
  role: string | null;
  entreprise: string | null;
  entrepriseId: string | null;
  oppsOuvertes: number;
  prochaineActivite: string | null;
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
  phase: InstanceSummary['phase'];
  aValider: number;
  tachesEnRetard: number | null;
  rdv7j: number | null;
  routinesActives: number | null;
};

// Erreur d'API : garde le statut et le corps, pour les refus qui appellent une réponse de l'écran
// (par exemple l'alerte du semestre du Test de VMA, code « semestre »).
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly corps: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string } & Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new ApiError(body.error ?? `Erreur ${response.status} sur ${url}`, response.status, body);
  }
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

// Test de VMA : invitations envoyées par le site, résultats relevés (voir src/vma).
export type TestVmaType = 'premier' | 'essai';
export type TestVmaStatut = 'envoyee' | 'utilisee' | 'revoquee';
export type TestVma = {
  id: string;
  entrepriseId: string | null;
  entrepriseNom: string;
  contactNom: string | null;
  contactEmail: string | null;
  type: TestVmaType;
  statut: TestVmaStatut;
  lien: string;
  expireLe: string;
  creeLe: string;
  recueLe: string | null;
  version: string | null;
  // Écran du dirigeant (ce qu'il a vu) : seulement après l'envoi.
  resultat: {
    entreprise: string;
    vma: number | null;
    mesurable: boolean;
    statut: string;
    tenue: string;
    allureVisee: number;
    echeance: number;
    niveau: { cle: string; label: string; phrase: string };
    ecart: number | null;
    // Socle récurrent par mois (null sans récurrent) et allure actuelle = VMA + récurrent (v0.2).
    recurrent?: number | null;
    allureActuelle?: number;
    freins: { n: number; titre: string; phrase: string }[];
  } | null;
  // Calcul complet, pour la fiche de Marc (gains et blocs inclus) : jamais montré au dirigeant.
  calcul: {
    vma?: number;
    statut?: string;
    recurrent?: number;
    recurrentEstime?: boolean;
    allureActuelle?: number;
    partRecurrent?: number | null;
    ratioAllure?: number | null;
    potentiel?: number;
    niveau?: { cle: string; part?: number; parAn?: number };
    freins?: {
      n: number;
      label: string;
      note: number;
      gainMax: number;
      gainRestant: number;
      bloc: string;
    }[];
  } | null;
};
export type NouveauTestVma = {
  entrepriseId?: string | null;
  entrepriseNom: string;
  type: TestVmaType;
  contactNom?: string | null;
  contactEmail?: string | null;
  // Confirmation de Marc à l'alerte du semestre.
  confirmerSemestre?: boolean;
};

export const fetchTestsVma = (slug: string) => getJson<TestVma[]>(inst(slug, 'vma/tests'));
export const creerTestVma = (slug: string, nouveau: NouveauTestVma) =>
  sendJson<TestVma>('POST', inst(slug, 'vma/tests'), nouveau);
export const revoquerTestVma = (slug: string, id: string) =>
  sendJson<TestVma>('POST', inst(slug, `vma/tests/${encodeURIComponent(id)}/revoquer`), {});

export const fetchJournal = (slug: string) => getJson<JournalEntry[]>(inst(slug, 'journal'));
export const fetchInstanceFiche = (slug: string) => getJson<InstanceFiche>(inst(slug, 'instance'));
export const renameInstance = (slug: string, nom: string) =>
  sendJson<InstanceSummary>('PATCH', inst(slug, 'instance'), { nom });
export const changerPhase = (slug: string, phase: 'closing' | 'en_cours') =>
  sendJson<InstanceSummary>('PUT', inst(slug, 'phase'), { phase });
export const creerProspect = (nom: string) =>
  sendJson<InstanceSummary>('POST', '/api/prospects', { nom });
export const reinitialiserDemo = (slug: string) =>
  sendJson<{ ok: true }>('POST', inst(slug, 'demo/reinitialiser'), {});
export const convertirProspect = (slug: string, crm: 'hubspot' | null) =>
  sendJson<InstanceSummary>('POST', inst(slug, 'convertir'), { crm });
export const creerMandatDepuisAffaire = (slug: string, id: string, crm: 'hubspot' | null) =>
  sendJson<InstanceSummary>('POST', inst(slug, `opportunites/${id}/mandat`), { crm });
export const lierMandat = (slug: string, id: string, mandat: string) =>
  sendJson<InstanceSummary>('POST', inst(slug, `opportunites/${id}/mandat/lier`), {
    slug: mandat,
  });
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
  degrade?: boolean;
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
export const brancherHubspot = (
  slug: string,
  token: string,
  mode: 'standard' | 'degrade' = 'standard',
) => sendJson<{ ok: true }>('POST', inst(slug, 'connexions/hubspot'), { token, mode });
export const brancherInfomaniak = (slug: string, email: string, motDePasse: string) =>
  sendJson<{ ok: true }>('POST', inst(slug, 'connexions/infomaniak'), { email, motDePasse });
export type ApercuMessagerie = {
  compte: string;
  jours: number;
  fils: number;
  brouillons: number;
  derniers: { de: string | null; objet: string | null; date: string | null }[];
};
export const testerMessagerie = (slug: string) =>
  sendJson<ApercuMessagerie>('POST', inst(slug, 'connexions/messagerie/apercu'), {});
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
  derniereActivite: string | null;
  prochaine: { echeance: string; enRetard: boolean } | null;
  joursInactif: number | null;
};

export type Pipeline = {
  source: 'natif' | 'hubspot';
  ecrit: boolean;
  derniereSynchro: string | null;
  etapes: { id: string; label: string; probabilite?: number | null }[];
  conversions: (number | null)[];
  inactiviteJours: number;
  opportunites: PipelineOpp[];
};
export const createOpportunite = (
  slug: string,
  input: {
    titre: string;
    etape: string;
    montant: number | null;
    echeance: string | null;
    entrepriseId: string | null;
    contactId: string | null;
  },
) => sendJson<PipelineOpp | SimulationTache>('POST', inst(slug, 'opportunites'), input);
export const saveReglagesPipeline = (slug: string, inactiviteJours: number) =>
  sendJson<{ inactiviteJours: number }>('PATCH', inst(slug, 'pipeline/reglages'), {
    inactiviteJours,
  });

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
export type Brief = {
  source: 'hubspot' | 'natif';
  aFaire: { retard: number; jour: Compte };
  rdv: { debut: string; fin: string; titre: string; lieu: string | null; journee: boolean }[];
  rdvEtat: 'ok' | 'non_configure' | 'erreur';
  rdvErreur?: string;
  realisees: {
    veille: Compte & { jour: string };
    semaine: Compte;
    mois: Compte;
    aujourdhui: Compte;
  };
  // Meetings held over the same periods; null when the agenda could not be read.
  rdvTenus: { veille: number; semaine: number; mois: number } | null;
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

export type TypeSujet =
  | 'mail_a_repondre'
  | 'devis'
  | 'diagnostic'
  | 'compte_rendu'
  | 'brouillon_non_envoye'
  | 'a_valider'
  | 'autre';
export type SujetVue = {
  id: string;
  type: TypeSujet;
  titre: string;
  resume: string | null;
  origine: 'messagerie' | 'agenda' | 'cerveau' | 'os' | 'site';
  lien: string | null;
  echeance: string | null;
  priorite: number;
  statut: 'a_traiter' | 'tache' | 'traite';
  tacheId: string | null;
  createdAt: string;
  traiteAt: string | null;
  contact: { id: string; nom: string } | null;
  entreprise: { id: string; nom: string } | null;
  instance: { slug: string; nom: string; couleur: string | null };
  proposition: PropositionItem | null;
};

export const fetchBrief = (slug: string) => getJson<Brief>(inst(slug, 'brief'));
export type TacheVue = {
  id: string;
  titre: string;
  notes: string | null;
  canal: 'email' | 'appel' | 'tache';
  type: 'appel' | 'email' | 'tache' | 'reunion' | 'echeance' | 'dejeuner';
  avecHeure: boolean;
  dureeMinutes: number | null;
  occupe: boolean;
  echeance: string | null;
  fait: boolean;
  origine: 'hubspot' | 'os';
  contact: { id: string; nom: string; email?: string | null; telephone?: string | null } | null;
  entreprise?: { id: string; nom: string } | null;
  opportunite: { id: string; titre: string; clos: 'gagne' | 'perdu' | null } | null;
};
// A Google Agenda event as the Agenda shows it; `couleur` is the event's own Google colour.
export type RdvAgenda = {
  id: string;
  debut: string;
  fin: string;
  titre: string;
  lieu: string | null;
  journee: boolean;
  agenda: string;
  couleur: string | null;
};
export type SemaineTaches = {
  taches: TacheVue[];
  enRetard: TacheVue[];
  sansEcheance: TacheVue[];
  rdv: RdvAgenda[];
  rdvEtat: 'ok' | 'non_configure' | 'erreur';
  hubspot: boolean;
  ecrit: boolean;
};
export type SimulationTache = { simulation: true; message: string };
export type TacheSaisie = {
  titre?: string;
  notes?: string | null;
  echeance?: string | null;
  fait?: boolean;
  type?: TacheVue['type'];
  avecHeure?: boolean;
  dureeMinutes?: number | null;
  occupe?: boolean;
  contactId?: string | null;
  entrepriseId?: string | null;
  opportuniteId?: string | null;
};
export type Options = { ensuite: boolean };
export const fetchOptions = () =>
  getJson<{ options: Options }>('/api/preferences').then((r) => r.options);
export const saveOptions = (options: Partial<Options>) =>
  sendJson<{ options: Options }>('PUT', '/api/preferences/options', options);
export const fetchTaches = (slug: string, du: string, au: string) =>
  getJson<SemaineTaches>(inst(slug, `taches?du=${du}&au=${au}`));
export const fetchCompteurTaches = (slug: string) =>
  getJson<{ n: number }>(inst(slug, 'taches/compteur')).then((r) => r.n);
export const createTache = (slug: string, input: TacheSaisie & { hubspot: boolean }) =>
  sendJson<TacheVue | SimulationTache>('POST', inst(slug, 'taches'), input);
export const updateTache = (slug: string, id: string, patch: TacheSaisie) =>
  sendJson<TacheVue | SimulationTache>(
    'PATCH',
    inst(slug, `taches/${encodeURIComponent(id)}`),
    patch,
  );
export const fetchInbox = (slug: string, filtre: string) =>
  getJson<SujetVue[]>(inst(slug, `inbox?filtre=${encodeURIComponent(filtre)}`));
export const fetchCompteurInbox = (slug: string) =>
  getJson<{ n: number }>(inst(slug, 'inbox/compteur')).then((r) => r.n);
const sujet = (slug: string, id: string, action: string) =>
  inst(slug, `sujets/${encodeURIComponent(id)}/${action}`);
export const ajouterSujet = (
  slug: string,
  saisie: { titre: string; resume?: string; echeance?: string; priorite?: number },
) => sendJson<SujetVue>('POST', inst(slug, 'sujets'), saisie);
// Only the given fields change; an echeance of null removes the due date.
export const modifierSujet = (
  slug: string,
  id: string,
  modif: { echeance?: string | null; priorite?: number },
) => sendJson<SujetVue>('PATCH', inst(slug, `sujets/${encodeURIComponent(id)}`), modif);
export type EchangeAjout = {
  id: string;
  statut: 'attente_claude' | 'en_cours' | 'attente_pilote' | 'ajoute' | 'annule';
  messages: { de: 'pilote' | 'claude'; texte: string; at: string }[];
  brouillon: {
    type: Exclude<TypeSujet, 'a_valider'>;
    titre: string;
    resume: string | null;
    echeance: string | null;
  } | null;
  erreur: string | null;
  demandeAt: string;
};
const echange = (slug: string, id: string, action = '') =>
  inst(slug, `echanges/${encodeURIComponent(id)}${action && `/${action}`}`);
export const ouvrirEchange = (slug: string, texte: string) =>
  sendJson<EchangeAjout>('POST', inst(slug, 'echanges'), { texte });
export const fetchEchange = (slug: string, id: string) => getJson<EchangeAjout>(echange(slug, id));
export const repondreEchange = (slug: string, id: string, texte: string) =>
  sendJson<EchangeAjout>('POST', echange(slug, id, 'messages'), { texte });
export const ajouterDepuisEchange = (slug: string, id: string) =>
  sendJson<{ echange: EchangeAjout; sujet: SujetVue }>('POST', echange(slug, id, 'ajouter'), {});
export const annulerEchange = (slug: string, id: string) =>
  sendJson<EchangeAjout>('POST', echange(slug, id, 'annuler'), {});
export const marquerSujetTraite = (slug: string, id: string) =>
  sendJson<SujetVue>('POST', sujet(slug, id, 'traite'), {});
export const remettreSujet = (slug: string, id: string) =>
  sendJson<SujetVue>('POST', sujet(slug, id, 'a-traiter'), {});
export const sujetEnTache = (slug: string, id: string, saisie: TacheSaisie) =>
  sendJson<SujetVue | SimulationTache>('POST', sujet(slug, id, 'tache'), saisie);
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
  // Company chosen by hand, else the contact's.
  entreprise: { id: string; nom: string } | null;
  // Linked by hand in the OS rather than through the guests' emails.
  lienManuel: boolean;
  opportunite: { id: string; titre: string } | null;
  compteRendu: boolean;
};
export type RendezVousReponse = {
  etat: 'ok' | 'non_configure' | 'erreur';
  erreur?: string;
  rdv: RendezVous[];
  // Calendars chosen in Connexions that could not be read (unknown id, access withdrawn).
  agendasIgnores?: string[];
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
// Every calendar the Google account can see, with the ones the agenda reads chosen in Connexions.
export type AgendaDisponible = {
  id: string;
  nom: string;
  principal: boolean;
  role: string;
  couleur: string | null;
};
export type AgendasReponse =
  | { etat: 'non_configure'; agendas: [] }
  | { etat: 'erreur'; erreur: string; agendas: [] }
  | { etat: 'ok'; agendas: AgendaDisponible[] };
export const fetchAgendas = (slug: string) => getJson<AgendasReponse>(inst(slug, 'agendas'));
export const fetchRendezVous = (slug: string) =>
  getJson<RendezVousReponse>(inst(slug, 'rendez-vous'));
export const fetchPreparation = (slug: string, opportuniteId: string) =>
  getJson<Preparation>(inst(slug, `opportunites/${encodeURIComponent(opportuniteId)}/preparation`));
export const lierRendezVous = (
  slug: string,
  id: string,
  lien: { contactId: string | null; entrepriseId: string | null },
) => sendJson<{ ok: true }>('PUT', inst(slug, `rendez-vous/${encodeURIComponent(id)}/lien`), lien);
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

export type EtatControle = 'ok' | 'attention' | 'manque';
export type SanteRoutine = {
  cle: string;
  nom: string;
  skill: string;
  actif: boolean;
  resume: string;
  feu: EtatControle;
  controles: { id: string; libelle: string; etat: EtatControle; detail: string; action?: string }[];
  etapes: { texte: string; besoin: 'messagerie' | 'agenda' | null; bloquee: boolean }[];
  derniere: Execution | null;
};
export type Sante = {
  executeur: { actif: boolean; poste: string | null; vuLe: string | null };
  routines: SanteRoutine[];
};
export const fetchSante = (slug: string) => getJson<Sante>(inst(slug, 'routines/sante'));

export type KindFiche = 'affaire' | 'contact' | 'entreprise';
export type Evenement = {
  id: string;
  type: 'note' | 'appel' | 'email' | 'reunion' | 'activite' | 'etape';
  titre: string | null;
  texte: string | null;
  at: string;
  origine: 'hubspot' | 'os';
};
export type FicheDetail = {
  kind: KindFiche;
  fiche: Record<string, unknown> & { id: string; origine: 'hubspot' | 'os' };
  liens: {
    entreprise?: { id: string; nom: string } | null;
    contact?: { id: string; nom: string } | null;
    affaires?: {
      id: string;
      titre: string;
      etape: string;
      clos: string | null;
      montant: number | null;
    }[];
    contacts?: { id: string; nom: string }[];
  };
  aVenir: TacheVue[];
  historique: Evenement[];
  etapes?: { id: string; label: string; probabilite: number | null; jours: number | null }[];
  ecrit: boolean;
  // Deal of the own activity only: the mandate created from (or linked to) it.
  mandat?: { slug: string; nom: string } | null;
};
const fiche = (slug: string, kind: KindFiche, id: string) =>
  inst(slug, `fiches/${kind}/${encodeURIComponent(id)}`);
export const fetchFiche = (slug: string, kind: KindFiche, id: string) =>
  getJson<FicheDetail>(fiche(slug, kind, id));
export const patchFiche = (
  slug: string,
  kind: KindFiche,
  id: string,
  patch: Record<string, unknown>,
) => sendJson<FicheDetail | SimulationTache>('PATCH', fiche(slug, kind, id), patch);
export const noteFiche = (
  slug: string,
  kind: KindFiche,
  id: string,
  note: { corps: string; hubspot: boolean },
) => sendJson<FicheDetail | SimulationTache>('POST', `${fiche(slug, kind, id)}/notes`, note);
export const fetchOpportunitesRecherche = (slug: string, q: string) =>
  getJson<{ id: string; titre: string; entreprise: string | null; clos: string | null }[]>(
    inst(slug, `opportunites/recherche?q=${encodeURIComponent(q)}`),
  );
export type Recherche = {
  affaires: { id: string; titre: string; entreprise: string | null; clos: string | null }[];
  personnes: { id: string; nom: string; entreprise: string | null }[];
  organisations: { id: string; nom: string; ville: string | null }[];
};
export const fetchRecherche = (slug: string, q: string) =>
  getJson<Recherche>(inst(slug, `recherche?q=${encodeURIComponent(q)}`));

// Site web (module site-web): the website's Google Analytics audience.
export type EtatSiteWeb = {
  googleClientDisponible: boolean;
  connecte: boolean;
  propriete: { proprieteId: string; proprieteNom: string } | null;
};
export type ProprieteAnalytics = { id: string; nom: string; compte: string };
export type IndicateursSite = {
  visiteurs: number;
  nouveaux: number;
  sessions: number;
  engagement: number;
  dureeMoyenne: number;
  pagesVues: number;
};
export type RapportSite = {
  periode: { du: string; au: string };
  precedente: { du: string; au: string };
  actuel: IndicateursSite;
  precedent: IndicateursSite;
  demandes: { actuel: number; precedent: number };
  mois: { mois: string; visiteurs: number; sessions: number }[];
  canaux: { canal: string; sessions: number; engagement: number }[];
  pages: { chemin: string; titre: string; vues: number; visiteurs: number }[];
  sources: { source: string; sessions: number }[];
  genereLe: string;
};
export type TempsReelSite = {
  visiteurs: number;
  parMinute: number[];
  pages: { titre: string; visiteurs: number }[];
  genereLe: string;
};
export const fetchSiteWeb = (slug: string) => getJson<EtatSiteWeb>(inst(slug, 'site-web'));
export const fetchProprietes = (slug: string) =>
  getJson<ProprieteAnalytics[]>(inst(slug, 'site-web/proprietes'));
export const choisirPropriete = (slug: string, id: string, nom: string) =>
  sendJson<EtatSiteWeb['propriete']>('PUT', inst(slug, 'site-web/propriete'), { id, nom });
export const fetchRapportSite = (slug: string, frais = false) =>
  getJson<RapportSite>(inst(slug, `site-web/rapport${frais ? '?frais=1' : ''}`));
export const fetchTempsReelSite = (slug: string) =>
  getJson<TempsReelSite>(inst(slug, 'site-web/temps-reel'));
export const connecterAnalytics = (slug: string) =>
  sendJson<{ url: string }>('POST', inst(slug, 'site-web/google/start'), {});

// Diagnostic d'Endurance Commerciale : projets de l'espace SIMATIS (voir src/diagnostic).
export type Dimensions = { outils: number; strategie: number; polyvalence: number };
export type Profil = 'Joggeur' | 'Sprinteur' | 'Marathonien' | 'Ultra-endurant';
export type ChatEtape = { modele: string; effort: string; lien: string };
export type Diapositive = { titre: string; texte: string; notes: string };
export type LettreReponse = 'A' | 'B' | 'C' | 'D' | 'E' | 'N/A';
export type ProjetDiag = {
  id: string;
  nom: string;
  activite: string;
  // Facultatif tant que le projet n'est pas rattaché (voir diagnostic:rattacher).
  entrepriseId?: string | null;
  contexte: string;
  etape: number;
  etapeMax: number;
  dims: Dimensions | null;
  statutDiagnostic: 'Rapport à rédiger' | 'Restitué' | null;
  dateDiagnostic: string | null;
  chats: Record<string, ChatEtape>;
  profil: Profil | null;
  revue: Record<string, unknown> | null;
  conversation: {
    etape: number;
    de: 'pilote' | 'claude';
    texte: string;
    at: string;
    erreur?: boolean;
  }[];
  statutChat: 'repos' | 'attente_claude' | 'en_cours';
  demande: 'preparer_support' | 'support_final' | 'rapport' | 'entretien' | null;
  aPdfEntretien: boolean;
  pdfEntretienNom: string | null;
  reponsesEntretien: { section: string; numero: number; reponse: LettreReponse }[];
  historiqueReponses: { question: string; ancienne: string; nouvelle: string; le: string }[];
  ditParDirigeant: string;
  hypotheses: string;
  aLogo: boolean;
  logoNom: string | null;
  supportStatut: 'aucun' | 'preparation' | 'pret' | 'final';
  supportLien: string | null;
  supportTexte: Diapositive[] | null;
  supportFinalLe: string | null;
  aRapport: boolean;
  rapportNom: string | null;
  rapportLienStatut: 'aucun' | 'en_cours' | 'pret';
  rapportLien: string | null;
  rapportLiens: { lien: string; le: string }[];
  updatedAt: string;
};
export type ProjetDiagPatch = Partial<
  Pick<
    ProjetDiag,
    | 'nom'
    | 'activite'
    | 'contexte'
    | 'etape'
    | 'dims'
    | 'statutDiagnostic'
    | 'dateDiagnostic'
    | 'chats'
    | 'revue'
    | 'ditParDirigeant'
    | 'hypotheses'
  >
> & { logo?: { nom: string; base64: string } | null };

export const fetchProjetsDiag = (slug: string) =>
  getJson<ProjetDiag[]>(inst(slug, 'diagnostic/projets'));
export const creerProjetDiag = (
  slug: string,
  nom: string,
  activite: string,
  entrepriseId?: string,
) =>
  sendJson<ProjetDiag>('POST', inst(slug, 'diagnostic/projets'), {
    nom,
    activite,
    ...(entrepriseId ? { entrepriseId } : {}),
  });
export const majProjetDiag = (slug: string, id: string, patch: ProjetDiagPatch) =>
  sendJson<ProjetDiag>('PATCH', inst(slug, `diagnostic/projets/${encodeURIComponent(id)}`), patch);
export const envoyerMessageDiag = (slug: string, id: string, texte: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/messages`),
    { texte },
  );
export const demandeSupportDiag = (
  slug: string,
  id: string,
  action: 'preparer' | 'final' | 'rouvrir',
) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/support/${action}`),
    {},
  );
// Import du PDF de l'outil externe (étape 2) : Claude en lit les réponses.
export const importerEntretienDiag = (
  slug: string,
  id: string,
  pdf: { nom: string; base64: string },
) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/entretien`),
    pdf,
  );
// Correction d'une réponse lue : le profil se recalcule côté OS.
export const corrigerReponseDiag = (
  slug: string,
  id: string,
  corps: { section: string; numero: number; reponse: LettreReponse },
) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/entretien/reponse`),
    corps,
  );
// Vide les messages de l'assistant pour une étape (refusé pendant que Claude répond).
export const viderConversationDiag = (slug: string, id: string, etape: number) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/messages/vider`),
    { etape },
  );
// Demande la rédaction du rapport par Claude (étape 4, revue validée).
export const demandeRapportDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/rapport/produire`),
    {},
  );
export const urlLogoDiag = (slug: string, id: string) =>
  inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/logo`);
