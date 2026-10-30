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
  montantMensuelOuvert: number;
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

export type LigneConsole = {
  id: string;
  at: string;
  source: 'journal' | 'routine';
  acteur: string;
  niveau: 'ok' | 'info' | 'attention' | 'erreur';
  texte: string;
};
export type ConsoleOS = { lignes: LigneConsole[]; enCours: boolean };

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
const sendJson = <T>(method: 'PUT' | 'PATCH' | 'POST' | 'DELETE', url: string, payload: unknown) =>
  request<T>(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

const inst = (slug: string, path: string) => `/api/i/${encodeURIComponent(slug)}/${path}`;

// Test de VMA : invitations envoyées par le site, résultats relevés (voir src/vma).
export type TestVmaType = 'premier' | 'essai';
export type TestVmaStatut = 'envoyee' | 'utilisee' | 'revoquee';
export type FreinVma = {
  n: number;
  titre: string;
  phrase: string;
  // v2.1 : estimation moyenne, réponse du dirigeant, pratique la plus avancée, par où commencer.
  enjeu?: number;
  reponse?: string;
  cible?: string;
  debut?: string[];
  signe?: string;
};
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
    // v2.0 (module Portefeuille) : allure et socle à l'échéance si rien ne change ; l'écart se lit alors sur elle.
    trajectoire?: number | null;
    socleEcheance?: number | null;
    pastille?: string;
    // v2.3 (parcours Lancement) : VMA prévue faute de devis, résultat sur peu de devis, parcours suivi.
    previsionnel?: boolean;
    indicatif?: boolean;
    parcours?: string;
    ecartPct?: number | null;
    freins: FreinVma[];
    // v2.2 (mode portefeuille) : le dirigeant lit deux listes, conquête et portefeuille, avec l'écart de chacune.
    modePortefeuille?: boolean;
    freinsConquete?: FreinVma[];
    freinsPortefeuille?: FreinVma[];
    spotCible?: number | null;
    spotEcheance?: number | null;
    ecartSpot?: number | null;
    recurrentCible?: number | null;
    ecartRecurrent?: number | null;
    partRecActuelle?: number | null;
    partRecVisee?: number | null;
    // Libellés et définitions tels que le dirigeant les a lus (absents des résultats anciens).
    textes?: Record<string, string>;
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
    // v2.0 : potentiel de la seule VMA, et dynamique du portefeuille (taux annuels).
    potentielVma?: number;
    trajectoire?: number;
    socleEcheance?: number;
    partRec?: number;
    attrition?: number;
    developpement?: number;
    niveau?: { cle: string; part?: number; parAn?: number };
    freins?: {
      n: number;
      label: string;
      note: number;
      gainMax: number;
      gainRestant: number;
      bloc: string;
      moteur?: string;
      effet?: string;
      // Gain d'allure à l'échéance si ce frein seul était levé (v2.0).
      impact?: number;
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
// Le mail d'invitation part à la création quand une adresse est donnée : null sans adresse.
export type EnvoiInvitation = { statut: 'envoye' | 'simule' | 'echec'; raison?: string };
export type TestVmaCree = TestVma & { envoi: EnvoiInvitation | null };
export const creerTestVma = (slug: string, nouveau: NouveauTestVma) =>
  sendJson<TestVmaCree>('POST', inst(slug, 'vma/tests'), nouveau);
export const revoquerTestVma = (slug: string, id: string) =>
  sendJson<TestVma>('POST', inst(slug, `vma/tests/${encodeURIComponent(id)}/revoquer`), {});

// Espace testeur du Test de VMA : le site ouvre une session de 12 h, rien n'est gardé dans l'OS.
export const ouvrirEspaceTesteurVma = (slug: string) =>
  sendJson<{ lien: string; expireLe: string }>('POST', inst(slug, 'vma/testeur'), {});

export const supprimerTestVma = (slug: string, id: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `vma/tests/${encodeURIComponent(id)}`), {});

export const fetchJournal = (slug: string) => getJson<JournalEntry[]>(inst(slug, 'journal'));
export type EspaceCerveau = 'simatis' | 'partage';
export const fetchCarteCerveau = (slug: string, espace: EspaceCerveau = 'simatis') =>
  getJson<import('./cerveau.js').CarteCerveau | null>(
    `${inst(slug, 'cerveau/carte')}?espace=${espace}`,
  );
export type OperationCerveau =
  | { espace?: EspaceCerveau; type: 'lire'; chemin: string }
  | { espace?: EspaceCerveau; type: 'ecrire'; chemin: string; contenu: string; empreinte: string }
  | { espace?: EspaceCerveau; type: 'ajouter'; titre: string; texte: string; concerne?: 'os' }
  | {
      espace: 'partage';
      type: 'message';
      genre: 'question' | 'reponse' | 'info';
      sujet: string;
      corps: string;
      enReponseA?: string;
    }
  | { espace: 'partage'; type: 'actualiser' };
// Lire, enregistrer une note, ajouter une idée, déposer un message : exécuté sur le dossier du Drive
// (SIMATIS) ou dans l'espace partagé kDrive (Partagé).
export const operationCerveau = (slug: string, operation: OperationCerveau) =>
  sendJson<{
    chemin?: string;
    contenu?: string;
    empreinte?: string;
    lectureSeule?: string | null;
  }>('POST', inst(slug, 'cerveau/operations'), operation);
export const fetchConsole = (slug: string) => getJson<ConsoleOS>(inst(slug, 'console'));
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
  input: { nom: string; secteur?: string; ville?: string; lierA?: RefFiche },
) =>
  sendJson<{ id: string; avertissement?: string; message?: string }>(
    'POST',
    inst(slug, 'entreprises'),
    input,
  );
export const createContact = (
  slug: string,
  input: {
    nom: string;
    fonction?: string;
    email?: string;
    entrepriseId?: string | null;
    lierA?: RefFiche;
  },
) =>
  sendJson<{ id: string; avertissement?: string; message?: string }>(
    'POST',
    inst(slug, 'contacts'),
    input,
  );

export type ReglagesCrm = {
  frequence?: '5min' | '15min' | '1h' | '3h' | '1j' | 'manuel';
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
  googleDriveManquant: boolean;
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
// Paramètres > Partenaires : OS partenaires reliés par le relais d'agents (src/partenaires).
export type ObjetCrm = 'entreprise' | 'contact' | 'affaire' | 'tache' | 'rendez_vous' | 'activite';
export type Voit = { objets: ObjetCrm[]; champsExclus: string[]; qualification: boolean };
export type PartenaireVue = {
  id: string;
  nom: string;
  connecteDepuis: string;
  niveau: 'L0' | 'L1' | 'L2' | 'L3';
  voit: Voit;
  statut: 'active' | 'coupee';
  coupeeAt: string | null;
  synchroAt: string | null;
};
export type MissionVue = {
  id: string;
  sens: 'envoyee' | 'recue';
  titre: string;
  partenaire: string;
  etat: string;
  dernierMessage: string | null;
  creeeLe: string;
  majLe: string;
};
export type PartenairesReponse = {
  actif: boolean;
  porteuse: boolean;
  ecrituresReelles: boolean;
  inscrit: boolean;
  objets: ObjetCrm[];
  champsExcluables: { cle: string; libelle: string }[];
  partenaires: PartenaireVue[];
  missions: MissionVue[];
};
export const fetchPartenaires = (slug: string) =>
  getJson<PartenairesReponse>(inst(slug, 'partenaires'));
export const rejoindrePartenaire = (slug: string, lien: string) =>
  sendJson<{ partenaire: PartenaireVue }>('POST', inst(slug, 'partenaires/rejoindre'), { lien });
export const reglerPartenaire = (
  slug: string,
  id: string,
  reglages: { niveau?: PartenaireVue['niveau']; voit?: Voit },
) =>
  sendJson<{ partenaire: PartenaireVue }>(
    'PATCH',
    inst(slug, `partenaires/${encodeURIComponent(id)}`),
    reglages,
  );
export const couperPartenaire = (slug: string, id: string) =>
  sendJson<{ partenaire: PartenaireVue }>(
    'DELETE',
    inst(slug, `partenaires/${encodeURIComponent(id)}`),
    {},
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
  modeFacturation: 'spot' | 'recurrent';
  dureeEngagementMois: number;
  taciteReconduction: boolean;
  probabiliteManuelle: number | null;
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
    modeFacturation: 'spot' | 'recurrent';
    dureeEngagementMois: number;
    taciteReconduction: boolean;
    echeance: string | null;
    entrepriseId: string | null;
    contactId: string | null;
    lierA?: RefFiche;
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
  origine: 'messagerie' | 'agenda' | 'cerveau' | 'os' | 'site' | 'wispr' | 'partenaire';
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
  livreBlanc: { email: string; nom: string | null } | null;
  // Message de l'espace partagé (Christophe) auquel l'entrée permet de répondre.
  partage: { chemin: string } | null;
  // Réunion Wispr Flow ; dejaRelie : elle s'est reliée à un compte rendu déjà à faire.
  reunion: {
    critique: boolean;
    transcriptStocke: boolean;
    participants: string[];
    resume: string | null;
    dejaRelie: boolean;
  } | null;
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
  // Set by the Agenda: Mon activité also lists the tasks of its mandates.
  instance?: { slug: string; nom: string; couleur: string | null };
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
  instances: { slug: string; nom: string; couleur: string | null }[];
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
export const fetchCompteurRdv = (slug: string) =>
  getJson<{ n: number }>(inst(slug, 'rendez-vous/compteur')).then((r) => r.n);
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
export const attribuerReunionSujet = (
  slug: string,
  id: string,
  corps: { contactId: string | null; entrepriseId: string | null; critique: boolean },
) => sendJson<SujetVue>('POST', sujet(slug, id, 'reunion'), corps);
export type CandidatRdv = {
  eventId: string;
  titre: string;
  debut: string | null;
  compteRendu: boolean;
  propose: boolean;
};
export const fetchCandidatsRdv = (slug: string, id: string) =>
  getJson<CandidatRdv[]>(sujet(slug, id, 'rendez-vous'));
export const compteRenduSujet = (
  slug: string,
  id: string,
  corps: { eventId?: string; texte: string },
) => sendJson<SujetVue>('POST', sujet(slug, id, 'compte-rendu'), corps);
export const marquerSujetTraite = (slug: string, id: string) =>
  sendJson<SujetVue>('POST', sujet(slug, id, 'traite'), {});
export const remettreSujet = (slug: string, id: string) =>
  sendJson<SujetVue>('POST', sujet(slug, id, 'a-traiter'), {});
export const sujetEnTache = (slug: string, id: string, saisie: TacheSaisie) =>
  sendJson<SujetVue | SimulationTache>('POST', sujet(slug, id, 'tache'), saisie);
export const envoyerLivreBlanc = (slug: string, id: string, numero: 1 | 2) =>
  sendJson<SujetVue | SimulationTache>('POST', sujet(slug, id, 'livre-blanc'), { numero });
export const repondreSujet = (
  slug: string,
  id: string,
  reponse: { sujet: string; corps: string },
) => sendJson<SujetVue>('POST', sujet(slug, id, 'repondre'), reponse);
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
  pipeline: { montant: number; mensuel: number; engage: number; nombre: number };
  chaudes: { montant: number; mensuel: number; engage: number; nombre: number };
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
  // a_trier: not decided yet; rdv: a commercial meeting; ignore: « Pas un RDV ».
  statut: StatutRdv;
};
export type StatutRdv = 'a_trier' | 'rdv' | 'ignore';
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
// A meeting created in the OS, without Google: its id starts with `os:`.
export const creerRdvOs = (
  slug: string,
  saisie: { titre: string; debut: string; dureeMinutes: number; lieu: string | null },
) => sendJson<{ id: string }>('POST', inst(slug, 'rendez-vous'), saisie);
export const fetchPreparation = (slug: string, opportuniteId: string) =>
  getJson<Preparation>(inst(slug, `opportunites/${encodeURIComponent(opportuniteId)}/preparation`));
export const lierRendezVous = (
  slug: string,
  id: string,
  lien: { contactId: string | null; entrepriseId: string | null },
) => sendJson<{ ok: true }>('PUT', inst(slug, `rendez-vous/${encodeURIComponent(id)}/lien`), lien);
export type RdvFiche = {
  id: string;
  titre: string;
  debut: string | null;
  fin: string | null;
  lieu: string | null;
  statut: StatutRdv;
  contacts: { id: string; nom: string; detail: string | null }[];
  entreprises: { id: string; nom: string }[];
  affaires: { id: string; nom: string }[];
  participants: { email: string; contact: { id: string; nom: string } | null }[];
  compteRendu: { texte: string; at: string | null } | null;
};
export const fetchRdv = (slug: string, id: string) =>
  getJson<RdvFiche>(inst(slug, `rendez-vous/${encodeURIComponent(id)}`));
export const trierRdv = (slug: string, id: string, statut: StatutRdv) =>
  sendJson<{ ok: true }>('PATCH', inst(slug, `rendez-vous/${encodeURIComponent(id)}`), { statut });
export const lierRdv = (
  slug: string,
  id: string,
  cible: { kind: KindFiche; id: string },
  retirer = false,
) =>
  sendJson<{ ok: true }>(
    retirer ? 'DELETE' : 'POST',
    inst(slug, `rendez-vous/${encodeURIComponent(id)}/liens`),
    cible,
  );
export const enregistrerCompteRenduRdv = (
  slug: string,
  rdv: { id: string; titre: string },
  texte: string,
  options: { proposerTache: boolean; versCerveau: boolean },
) =>
  sendJson<unknown>('POST', inst(slug, `rendez-vous/${encodeURIComponent(rdv.id)}/compte-rendu`), {
    titre: rdv.titre,
    texte,
    ...options,
  });
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
  type: 'note' | 'appel' | 'email' | 'reunion' | 'compte_rendu' | 'activite' | 'etape';
  titre: string | null;
  texte: string | null;
  at: string;
  origine: 'hubspot' | 'os';
};
export type RdvLie = { id: string; titre: string; debut: string | null; compteRendu: boolean };
export type LienFiche = { id: string; nom: string; principal: boolean };
export type RefFiche = { kind: KindFiche; id: string };
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
      principal?: boolean;
    }[];
    // Every link (HubSpot-like many-to-many); `contact` and `entreprise` are the primary ones.
    contacts?: LienFiche[];
    entreprises?: LienFiche[];
  };
  aVenir: TacheVue[];
  rendezVous: RdvLie[];
  // Espace SIMATIS, organisation ou contact seulement.
  diagnostics?: {
    id: string;
    nom: string;
    etape: number;
    statut: string | null;
    date: string | null;
  }[];
  // Espace SIMATIS avec le module atelier : ateliers de l'entreprise (ou de celle du contact).
  ateliers?: { id: string; titre: string; etape: number; date: string }[];
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
export type EmailContact = { email: string; principal: boolean };
const emailsDe = (slug: string, id: string) => `${fiche(slug, 'contact', id)}/emails`;
export const ajouterEmailContact = (slug: string, id: string, email: string) =>
  sendJson<{ emails: EmailContact[] }>('POST', emailsDe(slug, id), { email });
export const retirerEmailContact = (slug: string, id: string, email: string) =>
  sendJson<{ emails: EmailContact[] }>('DELETE', emailsDe(slug, id), { email });
export const definirEmailPrincipal = (slug: string, id: string, email: string) =>
  sendJson<{ emails: EmailContact[] }>('PUT', `${emailsDe(slug, id)}/principal`, { email });
const liensDe = (slug: string, de: RefFiche) => `${fiche(slug, de.kind, de.id)}/liens`;
type ResultatLien = { ok: true } | SimulationTache;
export const lierFiche = (slug: string, de: RefFiche, avec: RefFiche) =>
  sendJson<ResultatLien>('POST', liensDe(slug, de), { avec });
export const delierFiche = (slug: string, de: RefFiche, avec: RefFiche) =>
  sendJson<ResultatLien>('DELETE', liensDe(slug, de), { avec });
export const definirPrincipal = (slug: string, de: RefFiche, avec: RefFiche) =>
  sendJson<ResultatLien>('PUT', `${liensDe(slug, de)}/principal`, { avec });
export type ResultatSuppression = {
  id: string;
  ok: boolean;
  simulation?: boolean;
  erreur?: string;
};
export const supprimerFiche = (slug: string, de: RefFiche) =>
  sendJson<ResultatLien>('DELETE', fiche(slug, de.kind, de.id), {});
export const supprimerFiches = (slug: string, kind: KindFiche, ids: string[]) =>
  sendJson<{ resultats: ResultatSuppression[] }>('POST', inst(slug, `fiches/${kind}/supprimer`), {
    ids,
  });
export const fusionnerFiches = (
  slug: string,
  kind: KindFiche,
  gardeId: string,
  absorbeId: string,
) => sendJson<ResultatLien>('POST', `${fiche(slug, kind, gardeId)}/fusion`, { absorbeId });
export const fetchOpportunitesRecherche = (slug: string, q: string) =>
  getJson<{ id: string; titre: string; entreprise: string | null; clos: string | null }[]>(
    inst(slug, `opportunites/recherche?q=${encodeURIComponent(q)}`),
  );
export type Recherche = {
  affaires: { id: string; titre: string; entreprise: string | null; clos: string | null }[];
  personnes: { id: string; nom: string; entreprise: string | null }[];
  organisations: { id: string; nom: string; ville: string | null }[];
};
// Seen from the own instance with « Inclure les mandats »: the mandates' results, read only.
export type RechercheMandat = Omit<Recherche, 'mandats'> & {
  instance: { slug: string; nom: string; couleur: string | null };
};
export const fetchRecherche = (slug: string, q: string) =>
  getJson<Recherche>(inst(slug, `recherche?q=${encodeURIComponent(q)}`));
export const fetchRechercheMandats = (slug: string, q: string) =>
  getJson<{ mandats: RechercheMandat[]; echecs?: string[] }>(
    inst(slug, `recherche?q=${encodeURIComponent(q)}&portee=mandats`),
  );

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
// Formule d'abonnement et options de la proposition (montants null = sur devis).
export type Proposition = {
  formule: {
    libelle: string;
    mensualite: number | null;
    engagementMois: number;
    tacite: boolean;
    prestations: string[];
  };
  options: {
    id: string;
    libelle: string;
    description: string;
    tarif: { mode: 'forfait' | 'mensuel'; montant: number | null };
  }[];
};
export type Diapositive = { titre: string; texte: string; notes: string };
export type LettreReponse = 'A' | 'B' | 'C' | 'D' | 'E' | 'N/A';
export type ProjetDiag = {
  id: string;
  nom: string;
  activite: string;
  // Facultatif tant que le projet n'est pas rattaché (voir diagnostic:rattacher).
  entrepriseId?: string | null;
  contactId?: string | null;
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
  demande:
    | 'preparer_support'
    | 'support_final'
    | 'rapport'
    | 'restitution'
    | 'restitution_export'
    | 'capitalisation_proposer'
    | 'capitalisation_enregistrer'
    | 'entretien'
    | null;
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
  rapportLiens: { lien: string; le: string; version?: number }[];
  rapportVersions: { version: number; le: string }[];
  restitutionStatut: 'aucun' | 'en_cours' | 'pret';
  restitutionLien: string | null;
  restitutionLiens: { lien: string; le: string }[];
  restitutionAvecProposition: boolean;
  // PowerPoint exporté depuis le deck : disponible au téléchargement, avec la date de l'export.
  aPptx: boolean;
  restitutionExportLe: string | null;
  // Capitalisation de la restitution : 'propose' quand Claude a répondu dans le chat, 'enregistre'
  // une fois écrite dans le second cerveau.
  capitalisationStatut: 'aucun' | 'en_cours' | 'propose' | 'enregistre';
  capitalisationRdvId: string | null;
  capitalisationCompteRenduAt: string | null;
  opportuniteId?: string | null;
  proposition: Proposition | null;
  updatedAt: string;
};
export type ProjetDiagPatch = Partial<
  Pick<
    ProjetDiag,
    | 'nom'
    | 'activite'
    | 'entrepriseId'
    | 'contactId'
    | 'opportuniteId'
    | 'contexte'
    | 'etape'
    | 'dims'
    | 'statutDiagnostic'
    | 'dateDiagnostic'
    | 'chats'
    | 'revue'
    | 'ditParDirigeant'
    | 'hypotheses'
    | 'restitutionAvecProposition'
    | 'proposition'
  >
> & { logo?: { nom: string; base64: string } | null };

export const fetchProjetsDiag = (slug: string) =>
  getJson<ProjetDiag[]>(inst(slug, 'diagnostic/projets'));
export const supprimerProjetDiag = (slug: string, id: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `diagnostic/projets/${encodeURIComponent(id)}`), {});
export const creerProjetDiag = (
  slug: string,
  nom: string,
  activite: string,
  entrepriseId?: string,
  contactId?: string,
) =>
  sendJson<ProjetDiag>('POST', inst(slug, 'diagnostic/projets'), {
    nom,
    activite,
    ...(entrepriseId ? { entrepriseId } : {}),
    ...(contactId ? { contactId } : {}),
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
// Word du rapport retravaillé hors de l'OS : il remplace le Word affiché (étape 4).
export const envoyerRapportDriveDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/rapport/drive`),
    {},
  );
export const importerRapportDiag = (
  slug: string,
  id: string,
  word: { nom: string; base64: string },
) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/rapport/importer`),
    word,
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
// Demande la rédaction du rapport par Claude (étape 4) : une nouvelle version à chaque fois.
export const demandeRapportDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/rapport/produire`),
    {},
  );
// Demande le deck de restitution du rapport (étape 5).
export const demandeRestitutionDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/restitution/produire`),
    {},
  );
// Rendez-vous de l'entreprise du projet qui ont un compte rendu, le plus récent d'abord.
export type RdvCapitalisation = {
  id: string;
  titre: string;
  debut: string | null;
  compteRenduAt: string;
};
export const rendezVousCapitalisationDiag = (slug: string, id: string) =>
  getJson<RdvCapitalisation[]>(
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/capitalisation/rendez-vous`),
  );
// Temps 1 : Claude relit le compte rendu et propose ce qu'il retient (rien n'est écrit).
export const proposerCapitalisationDiag = (slug: string, id: string, rdvId: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/capitalisation/proposer`),
    { rdvId },
  );
// Temps 2 : le pilote est d'accord, Claude écrit dans le second cerveau.
export const enregistrerCapitalisationDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/capitalisation/enregistrer`),
    {},
  );
// Demande l'export PowerPoint du deck de restitution (Claude relit le deck publié).
export const exporterRestitutionDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/restitution/exporter`),
    {},
  );
export const urlPptxRestitutionDiag = (slug: string, id: string) =>
  inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/restitution/pptx`);
export const urlRapportDiag = (slug: string, id: string, version?: number) =>
  inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/rapport`) +
  (version === undefined ? '' : `?version=${version}`);
// Word exported from the report's Google Doc (carries the edits made in Google Docs).
export const urlExportRapportDiag = (slug: string, id: string, version?: number) =>
  inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/rapport/export`) +
  (version === undefined ? '' : `?version=${version}`);
export const urlLogoDiag = (slug: string, id: string) =>
  inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/logo`);

// Bases vivantes : sas d'import puis base homogène (voir src/base-vivante).
export type ZoneBase = 'a_enrichir' | 'prospectable';
export type StatutLigneBase = 'pret' | 'sous_minimum' | 'doublon_interne' | 'integre';
export type ChampBase =
  | 'entreprise'
  | 'civilite'
  | 'prenom'
  | 'nom'
  | 'nomComplet'
  | 'email'
  | 'telephone'
  | 'portable'
  | 'fonction'
  | 'linkedin';
export type CorrespondanceBase = Partial<Record<ChampBase, number>>;
export type CompteursImportBase = {
  total: number;
  prospectables: number;
  aEnrichir: number;
  sousMinimum: number;
  doublonsInternes: number;
  integrees: number;
};
export type LigneImportBase = {
  numero: number;
  statut: StatutLigneBase;
  zone: ZoneBase | null;
  raison: string | null;
  avertissements: string[];
  alertes: string[];
  brut: string[];
  fiche: {
    entreprise: string | null;
    civilite: 'M.' | 'Mme' | null;
    civiliteDeduite: boolean;
    prenom: string | null;
    nom: string | null;
    email: string | null;
    telephone: string | null;
    fonction: string | null;
  };
};
export type ImportBase = {
  id: string;
  nomFichier: string;
  feuille: string;
  provenance: string;
  mandat: string | null;
  statut: 'apercu' | 'integre';
  creeLe: string;
  entetes: string[];
  correspondance: CorrespondanceBase;
  echantillon: string[][];
  compteurs: CompteursImportBase;
  lignes: LigneImportBase[];
  rapport: { creees: number; fusionnees: number } | null;
};
export type ResumeImportBase = Pick<
  ImportBase,
  'id' | 'nomFichier' | 'feuille' | 'provenance' | 'mandat' | 'statut' | 'creeLe' | 'rapport'
> & { compteurs: CompteursImportBase };
export type FicheBase = {
  id: string;
  zone: ZoneBase;
  entreprise: string;
  civilite: 'M.' | 'Mme' | null;
  prenom: string | null;
  // Empty while the record only knows its company (« à enrichir »).
  nom: string;
  email: string | null;
  telephone: string | null;
  fonction: string | null;
  provenance: string;
  mandat: string | null;
  statutProspection: StatutProspectionBase;
  dernierContactLe: string | null;
  dernierContactCanal: string | null;
  resultat: string | null;
  nbContacts: number;
  mandatContacteur: string | null;
  opposition: boolean;
  exclusion: ExclusionBase | null;
  emailInvalide: boolean;
  crmMandat: string | null;
  alertes: { code: string; libelle: string; bloquante: boolean }[];
};
export type StatutProspectionBase = 'jamais_contacte' | 'contacte' | 'a_repondu';
export type ExclusionBase = 'client' | 'partenaire' | 'concurrent';
export type AlerteBase =
  'recontact' | 'opposition' | 'email_invalide' | 'exclusion' | 'deja_en_crm';
export type FiltresBaseWeb = {
  zone?: ZoneBase;
  statut?: StatutProspectionBase;
  alerte?: AlerteBase;
  provenance?: string;
  q?: string;
};
export type EtatBase = {
  fiches: FicheBase[];
  total: number;
  compteurs: { aEnrichir: number; prospectable: number };
  provenances: string[];
  imports: ResumeImportBase[];
};
const paramsBase = (filtres: FiltresBaseWeb) => {
  const params = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(filtres))
    if (typeof valeur === 'string' && valeur.trim()) params.set(cle, valeur.trim());
  return params;
};
export const fetchBase = (slug: string, filtres: FiltresBaseWeb = {}, page = 0) => {
  const params = paramsBase(filtres);
  if (page > 0) params.set('page', String(page));
  const suite = params.toString();
  return getJson<EtatBase>(inst(slug, `base${suite ? `?${suite}` : ''}`));
};
export const urlExportBase = (slug: string, filtres: FiltresBaseWeb = {}) => {
  const suite = paramsBase(filtres).toString();
  return inst(slug, `base/export.csv${suite ? `?${suite}` : ''}`);
};
export const actualiserHistoriqueBase = (slug: string) =>
  sendJson<{ verifiees: number; trouvees: number }>(
    'POST',
    inst(slug, 'base/historique/actualiser'),
    {},
  );
export const majConformiteBase = (
  slug: string,
  id: string,
  patch: { opposition?: boolean; exclusion?: ExclusionBase | null; emailInvalide?: boolean },
) => sendJson<{ ok: true }>('PATCH', inst(slug, `base/fiches/${id}`), patch);
export const creerImportBase = (
  slug: string,
  payload: {
    nomFichier: string;
    contenuBase64?: string;
    texte?: string;
    provenance: string;
    mandat?: string;
  },
) => sendJson<ImportBase[]>('POST', inst(slug, 'base/imports'), payload);
export const fetchImportBase = (slug: string, id: string, statut: StatutLigneBase = 'pret') =>
  getJson<ImportBase>(inst(slug, `base/imports/${id}?statut=${statut}`));
export const reglerCorrespondanceBase = (
  slug: string,
  id: string,
  correspondance: Record<string, number | null>,
) =>
  sendJson<ImportBase>('PUT', inst(slug, `base/imports/${id}/correspondance`), { correspondance });
export const completerLigneBase = (
  slug: string,
  id: string,
  numero: number,
  champs: { entreprise?: string; nom?: string },
) => sendJson<LigneImportBase>('PATCH', inst(slug, `base/imports/${id}/lignes/${numero}`), champs);
export const integrerImportBase = (slug: string, id: string) =>
  sendJson<{ creees: number; fusionnees: number; restantes: number }>(
    'POST',
    inst(slug, `base/imports/${id}/integrer`),
    {},
  );
export const annulerImportBase = (slug: string, id: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `base/imports/${id}`), {});

export type ApportContactBase = {
  prenom?: string;
  nom?: string;
  email?: string;
  telephone?: string;
  fonction?: string;
};
export const enrichirFicheBase = (slug: string, id: string, apport: ApportContactBase) =>
  sendJson<{ zone: ZoneBase }>('POST', inst(slug, `base/fiches/${id}/enrichir`), apport);

// Rapprochement avec la boîte Gmail d'un mandat (lecture seule, depuis le début du mandat).
export type MandatBase = { slug: string; nom: string; debutMandat: string | null };
export type RapportBoiteBase = {
  messages: number;
  contactes: number;
  reponses: number;
  autos: number;
  bounces: number;
  jamaisContactes: number;
};
export type EtatRapprochementBase = {
  etat: 'en_cours' | 'termine' | 'echec';
  mandat: string;
  depuis: string;
  lus: number;
  total: number;
  rapport?: RapportBoiteBase;
  erreur?: string;
} | null;
export const fetchMandatsBase = (slug: string) => getJson<MandatBase[]>(inst(slug, 'base/mandats'));
export const majDebutMandatBase = (slug: string, mandat: string, debut: string | null) =>
  sendJson<{ ok: true }>('PUT', inst(slug, `base/mandats/${encodeURIComponent(mandat)}`), {
    debut,
  });
export const fetchRapprochementBase = (slug: string) =>
  getJson<EtatRapprochementBase>(inst(slug, 'base/rapprochement-mail'));
export const lancerRapprochementBase = (slug: string, mandat: string) =>
  sendJson<EtatRapprochementBase>('POST', inst(slug, 'base/rapprochement-mail'), { mandat });

// Réponses reçues : classées par Claude (routine « Base vivante »), validées par le pilote.
export type ClasseReponseBase =
  | 'sans_reponse'
  | 'repondu'
  | 'interesse'
  | 'pas_interesse'
  | 'mauvais_interlocuteur'
  | 'reponse_auto'
  | 'ne_plus_contacter';
export type ReponseBase = {
  id: string;
  entreprise: string;
  contact: string;
  mandat: string;
  recuLe: string;
  objet: string | null;
  extrait: string;
  classe: ClasseReponseBase | null;
};
export const fetchReponsesBase = (slug: string) =>
  getJson<{ aValider: ReponseBase[]; aClasser: number }>(inst(slug, 'base/reponses'));
export const validerReponseBase = (slug: string, id: string, classe: ClasseReponseBase) =>
  sendJson<{ ok: true }>('POST', inst(slug, `base/reponses/${id}/valider`), { classe });
export const entrerRepondantsBase = (slug: string) =>
  sendJson<{ cree: number; existant: number; simulation: number; refuse: number }>(
    'POST',
    inst(slug, 'base/crm/repondants'),
    {},
  );

// Transfert d'objets entre instances (src/transfert) : déplacement, ou copie pour un miroir d'outil.
export type TypeTransfert = 'sujet' | 'tache' | 'affaire' | 'contact' | 'entreprise' | 'rdv';
export type RefTransfert = { type: TypeTransfert; id: string };
export type NoeudTransfert = RefTransfert & {
  libelle: string;
  mode: 'deplace' | 'copie';
  obligatoire: boolean;
};
export type ApercuTransfert = {
  racine: NoeudTransfert;
  noeuds: NoeudTransfert[];
  liensRetires: string[];
  avertissements: string[];
  copieExistante: RefTransfert | null;
};
export type DemandeTransfert = RefTransfert & {
  instanceOrigine: string;
  instanceCible: string;
  exclusions: RefTransfert[];
  copierQuandMeme?: boolean;
};
export const fetchDroitTransfert = (slug: string) =>
  getJson<{ autorise: boolean }>(inst(slug, 'transfert/droit'));
export const apercuTransfert = (slug: string, demande: DemandeTransfert) =>
  sendJson<ApercuTransfert>('POST', inst(slug, 'transfert/apercu'), demande);
export const lancerTransfert = (slug: string, demande: DemandeTransfert) =>
  sendJson<{ deplaces: number; copies: number; racine: RefTransfert & { instance: string } }>(
    'POST',
    inst(slug, 'transfert'),
    demande,
  );

// Atelier stratégique (bêta) : stratégie, objectifs, ICP et feuille de route d'une entreprise.
export type AtelierListe = {
  id: string;
  entrepriseId: string;
  titre: string;
  etape: number;
  etapeMax: number;
  nbActions: number;
  createdAt: string;
  updatedAt: string;
};
export type AtelierDetail = Omit<AtelierListe, 'nbActions'> & { etat: Record<string, unknown> };

export const fetchAteliers = (slug: string) =>
  getJson<AtelierListe[]>(inst(slug, 'ateliers-strategie'));
export const fetchAtelier = (slug: string, id: string) =>
  getJson<AtelierDetail>(inst(slug, `ateliers-strategie/${encodeURIComponent(id)}`));
export const creerAtelier = (slug: string, entrepriseId: string, titre: string) =>
  sendJson<AtelierDetail>('POST', inst(slug, 'ateliers-strategie'), { entrepriseId, titre });
export const importerAtelier = (
  slug: string,
  entrepriseId: string,
  titre: string,
  sauvegarde: unknown,
) =>
  sendJson<AtelierDetail>('POST', inst(slug, 'ateliers-strategie/import'), {
    entrepriseId,
    titre,
    sauvegarde,
  });
// `keepalive` : la requête survit à la fermeture de l'onglet (le navigateur la limite à 64 Ko).
export const majAtelier = (
  slug: string,
  id: string,
  patch: { titre?: string; etat?: object },
  options?: { keepalive?: boolean },
) =>
  request<AtelierDetail>(inst(slug, `ateliers-strategie/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
    ...(options?.keepalive ? { keepalive: true } : {}),
  });
export const supprimerAtelier = (slug: string, id: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `ateliers-strategie/${encodeURIComponent(id)}`), {});

// Prospection : compteur du jour, statistiques et signatures (voir src/prospection).
export type StatsProspection = {
  jour: number;
  objectif: number;
  semaine: number;
  reponses: number;
  rdv: number;
  parTheme: Record<string, number>;
  parTouche: Record<string, number>;
  relancesFaites: number;
  relancesRestantes: number;
  aConfirmer: number;
};
export type SignatureProspection = {
  id: string;
  nom: string;
  defaut: boolean;
  typeMime: string;
};
export type OffreCampagne = 'vma' | 'diagnostic' | 'les-deux' | 'kairos';
export type ReglageCampagne = {
  offre: OffreCampagne;
  creneaux: boolean;
  signatureId: string | null;
  suivi: { type: 'courte' | 'longue' | 'date'; date?: string };
  touchesMax: number;
  style?: string;
};
export type ResultatCampagne = {
  brouillons: number;
  simulation: boolean;
  suivisCrees: number;
  suivisNonCrees: number;
  clos: number;
  faites: number;
  echecs: number;
  // Vrai : les mails sont partis ; faux : brouillons créés dans la messagerie.
  envoye: boolean;
};
export type CampagneResume = {
  id: string;
  mode: 'relance' | 'froid' | 'reponse';
  statut: StatutCampagne;
  creeLe: string;
  brouillons: number;
  resultat: ResultatCampagne | null;
};
export type VueProspection = {
  stats: StatsProspection;
  signatures: SignatureProspection[];
  recentes: CampagneResume[];
  enCours: string | null;
  froid: { disponibles: number; aRelancer: number };
  // Les deux verrous d'écriture sont ouverts : « Valider et envoyer » est proposé.
  envoiPossible: boolean;
};
export type StatutCampagne = 'redaction' | 'relecture' | 'terminee' | 'erreur';
export type EtatBrouillon = 'a_rediger' | 'pret' | 'a_verifier' | 'ecarte' | 'cree';
export type SuiviBrouillon = 'delai' | 'citee' | 'clos';
export type BrouillonCampagne = {
  id: string;
  contactNom: string;
  contactEmail: string;
  societe: string | null;
  touche: number;
  etat: EtatBrouillon;
  objet: string | null;
  corps: string | null;
  note: string | null;
  suiviType: SuiviBrouillon;
  suiviDate: string | null;
};
export type CampagneProspection = {
  id: string;
  mode: 'relance' | 'froid' | 'reponse';
  statut: StatutCampagne;
  reglage: ReglageCampagne;
  erreur: string | null;
  resultat: ResultatCampagne | null;
  brouillons: BrouillonCampagne[];
};
export type TacheRelance = {
  id: string;
  titre: string;
  contactNom: string | null;
  societe: string | null;
  echeance: string | null;
  touche: number;
  utilisable: boolean;
  suggestion: { contactId: string; contactNom: string; societe: string | null } | null;
};
export const fetchProspection = (slug: string) =>
  getJson<VueProspection>(inst(slug, 'prospection'));
export const reglerObjectifProspection = (slug: string, objectif: number) =>
  sendJson<{ ok: true }>('PUT', inst(slug, 'prospection/objectif'), { objectif });
export type ImageSignature = { typeMime: string; imageBase64: string };
export const ajouterSignatureProspection = (
  slug: string,
  signature: ImageSignature & { nom: string },
) => sendJson<SignatureProspection>('POST', inst(slug, 'prospection/signatures'), signature);
export const modifierSignatureProspection = (
  slug: string,
  id: string,
  champs: { nom?: string; defaut?: boolean },
) =>
  sendJson<{ ok: true }>(
    'PATCH',
    inst(slug, `prospection/signatures/${encodeURIComponent(id)}`),
    champs,
  );
export const remplacerImageSignature = (slug: string, id: string, image: ImageSignature) =>
  sendJson<{ ok: true }>(
    'PUT',
    inst(slug, `prospection/signatures/${encodeURIComponent(id)}/image`),
    image,
  );
export const supprimerSignatureProspection = (slug: string, id: string) =>
  sendJson<{ ok: true }>(
    'DELETE',
    inst(slug, `prospection/signatures/${encodeURIComponent(id)}`),
    {},
  );
export const urlImageSignature = (slug: string, id: string) =>
  inst(slug, `prospection/signatures/${encodeURIComponent(id)}/image`);
export const fetchTachesRelance = (slug: string) =>
  getJson<TacheRelance[]>(inst(slug, 'prospection/taches-relance'));
export const creerCampagneRelance = (
  slug: string,
  tacheIds: string[],
  reglage: ReglageCampagne,
  // Contact choisi pour une tâche que le CRM ne relie à personne : tâche => contact.
  liens: Record<string, string> = {},
) =>
  sendJson<{ campagneId: string; refusees: { tacheId: string; raison: string }[] }>(
    'POST',
    inst(slug, 'prospection/campagnes'),
    { mode: 'relance', tacheIds, reglage, ...(Object.keys(liens).length ? { liens } : {}) },
  );
export const fetchCampagne = (slug: string, id: string) =>
  getJson<CampagneProspection>(inst(slug, `prospection/campagnes/${encodeURIComponent(id)}`));
export const modifierBrouillonCampagne = (
  slug: string,
  campagneId: string,
  brouillonId: string,
  champs: {
    objet?: string;
    corps?: string;
    etat?: 'pret' | 'ecarte';
    suiviType?: SuiviBrouillon;
    suiviDate?: string | null;
  },
) =>
  sendJson<BrouillonCampagne>(
    'PATCH',
    inst(
      slug,
      `prospection/campagnes/${encodeURIComponent(campagneId)}/brouillons/${encodeURIComponent(brouillonId)}`,
    ),
    champs,
  );
export const finaliserCampagne = (
  slug: string,
  id: string,
  mode: 'brouillons' | 'envoi' = 'brouillons',
) =>
  sendJson<ResultatCampagne>(
    'POST',
    inst(slug, `prospection/campagnes/${encodeURIComponent(id)}/finaliser`),
    { mode },
  );
export const relancerRedaction = (slug: string, id: string) =>
  sendJson<{ ok: true }>(
    'POST',
    inst(slug, `prospection/campagnes/${encodeURIComponent(id)}/relancer`),
    {},
  );
export const rapprocherEnvoisProspection = (slug: string) =>
  sendJson<{ envoyes: number }>('POST', inst(slug, 'prospection/rapprocher'), {});

// Prospection à froid : contacts de la base vivante.
export type ContactFroid = {
  id: string;
  nom: string;
  entreprise: string;
  fonction: string | null;
  touche: number;
};
export type ContactAConfirmer = {
  id: string;
  nom: string;
  entreprise: string;
  touches: number;
  touchesMax: number;
  derniereLe: string | null;
};
export const fetchEchantillon = (slug: string, nombre: number, filtre: string) =>
  getJson<ContactFroid[]>(
    inst(
      slug,
      `prospection/echantillon?nombre=${nombre}${filtre.trim() ? `&filtre=${encodeURIComponent(filtre.trim())}` : ''}`,
    ),
  );
export const creerCampagneFroid = (slug: string, baseIds: string[], reglage: ReglageCampagne) =>
  sendJson<{ campagneId: string; refusees: { baseId: string; raison: string }[] }>(
    'POST',
    inst(slug, 'prospection/campagnes'),
    { mode: 'froid', baseIds, reglage },
  );
export const fetchEpuises = (slug: string) =>
  getJson<ContactAConfirmer[]>(inst(slug, 'prospection/epuises'));
export const confirmerEpuisesProspection = (slug: string, ids: string[]) =>
  sendJson<{ modifies: number }>('POST', inst(slug, 'prospection/epuises/confirmer'), { ids });
export const garderContactsProspection = (slug: string, ids: string[]) =>
  sendJson<{ modifies: number }>('POST', inst(slug, 'prospection/epuises/garder'), { ids });

// Réponse d'un contact à une campagne de prospection, reconnue dans l'Inbox.
export type ReponseCampagne = {
  occurrenceId: string;
  mode: 'relance' | 'froid';
  contactNom: string;
  societe: string | null;
  theme: string;
  touche: number;
  etat: string;
};
export const fetchReponseCampagne = (slug: string, sujetId: string) =>
  getJson<{ reponse: ReponseCampagne | null }>(
    inst(slug, `prospection/reponses/${encodeURIComponent(sujetId)}`),
  );
export const redigerReponseCampagne = (slug: string, sujetId: string) =>
  sendJson<{ campagneId: string }>(
    'POST',
    inst(slug, `prospection/reponses/${encodeURIComponent(sujetId)}/rediger`),
    {},
  );
