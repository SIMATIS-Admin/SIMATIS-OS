import type { InstanceSummary } from './nav.js';

export type StatutCommercial = 'suspect' | 'prospect' | 'client';

export type Entreprise = {
  id: string;
  statut: StatutCommercial;
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
  statut: StatutCommercial;
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

export type LimiteIA = { restant: number; reinitialiseLe: string };
export type FournisseurIA = {
  id: 'claude' | 'chatgpt';
  nom: string;
  etat: 'ok' | 'indisponible' | 'erreur';
  plan: string | null;
  fenetre5h: LimiteIA | null;
  hebdomadaire: LimiteIA | null;
};
export type LimitesIA = { actualiseLe: string | null; fournisseurs: FournisseurIA[] };

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
  // Méthode 3.0 : null quand l'enjeu n'est pas chiffré ; `nature` dit s'il s'agit d'un gain, d'une perte évitée ou d'un revenu sécurisé.
  enjeu?: number | null;
  nature?: string;
  reponse?: string;
  cible?: string;
  debut?: string[];
  signe?: string;
};
export type TestVma = {
  contactId?: string | null;
  opportuniteId?: string | null;
  id: string;
  entrepriseId: string | null;
  entrepriseNom: string;
  contactNom: string | null;
  contactEmail: string | null;
  // Registre des mails (vouvoiement par défaut) et suivi des envois.
  tutoiement: boolean;
  envoyeeLe: string | null;
  relances: { le: string; origine: 'manuelle' | 'auto' }[];
  echecEnvoi: string | null;
  // Relevés du site : première ouverture du mail (indicatif) et du lien.
  mailOuvertLe: string | null;
  lienOuvertLe: string | null;
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
    // Méthode 3.0 : trois catégories de revenus, flux séparés, deux conclusions (voir le cadrage du site).
    methode?: string;
    periode?: number;
    caMensuel?: { total: number; regulier: number; engage: number; ponctuel: number };
    tauxObserve?: number | null;
    objectif?: {
      caMensuel: number;
      echeance: number;
      partEngageeVisee: number | null;
      montantEngageMensuel: number | null;
    };
    projection?: {
      ca: number;
      caAvecReconduction: number | null;
      engage: number;
      engageAvecReconduction: number | null;
      echu: number;
    };
    conclusionCa?: {
      statut: string;
      manque: string[];
      ecart: number;
      ecartAvecReconduction: number | null;
      ecartPct: number | null;
    };
    composition?: { statut: string; partVisee?: number; cible?: number; partActuelle?: number };
    alertes?: { code: string }[];
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
    // Méthode 3.0 : CA mensuel par catégorie, ce qui manque pour conclure, rapport des montants.
    caMensuel?: number;
    regulier?: number;
    engage?: number;
    ponctuel?: number;
    manque?: string[];
    tauxObserve?: number | null;
    ecartReference?: number | null;
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
      // Absents (méthode 3.0) pour les freins sur les clients réguliers et les contrats : aucun coefficient.
      gainMax?: number | null;
      gainRestant?: number | null;
      bloc: string;
      moteur?: string;
      effet?: string;
      nature?: string;
      // Gain d'allure à l'échéance si ce frein seul était levé (v2.0) ; null en méthode 3.0 quand il n'est pas chiffré.
      impact?: number | null;
    }[];
  } | null;
};
export type NouveauTestVma = {
  entrepriseId?: string | null;
  entrepriseNom: string;
  type: TestVmaType;
  contactNom?: string | null;
  contactEmail?: string | null;
  tutoiement?: boolean;
  // Confirmation de Marc à l'alerte du semestre.
  confirmerSemestre?: boolean;
};

export type ContactVma = TestVma & {
  contactId: string | null;
  contactPrenom: string | null;
  contactNomFamille: string | null;
  contactPoste: string | null;
  contactTelephone: string | null;
  origine: 'inscription' | 'invitation';
  consentement: { accepteLe: string; version: string; texte: string; retireLe?: string } | null;
  contactLie: {
    id: string;
    nom: string;
    email: string | null;
    fonction: string | null;
    telephone: string | null;
    source: string;
  } | null;
  entrepriseLiee: { id: string; nom: string; source: string } | null;
};
export const fetchContactsVma = (slug: string) => getJson<ContactVma[]>(inst(slug, 'vma/contacts'));
export const creerLienProspectionVma = (slug: string) =>
  sendJson<{ lien: string; expireLe: string }>('POST', inst(slug, 'vma/liens-prospection'), {});
export const rattacherVma = (
  slug: string,
  id: string,
  choix: { entrepriseId?: string | null; contactId?: string | null; opportuniteId?: string | null },
) => sendJson<{ ok: true }>('PATCH', inst(slug, `vma/tests/${encodeURIComponent(id)}/crm`), choix);
export const retirerAccordVma = (slug: string, id: string) =>
  sendJson<{ ok: true }>(
    'POST',
    inst(slug, `vma/tests/${encodeURIComponent(id)}/retirer-accord`),
    {},
  );

export const fetchTestsVma = (slug: string) => getJson<TestVma[]>(inst(slug, 'vma/tests'));
// Le mail d'invitation part à la création quand une adresse est donnée : null sans adresse.
export type EnvoiInvitation = { statut: 'envoye' | 'simule' | 'echec'; raison?: string };
export type TestVmaCree = TestVma & { envoi: EnvoiInvitation | null };
export const creerTestVma = (slug: string, nouveau: NouveauTestVma) =>
  sendJson<TestVmaCree>('POST', inst(slug, 'vma/tests'), nouveau);
export const relancerTestVma = (slug: string, id: string, tutoiement: boolean) =>
  sendJson<TestVmaCree>('POST', inst(slug, `vma/tests/${encodeURIComponent(id)}/relancer`), {
    tutoiement,
  });
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
  | { espace: 'partage'; type: 'actualiser' }
  | { espace: 'partage'; type: 'chercher'; requete: string }
  | { espace: 'partage'; type: 'lire_messages'; chemins: string[] };
// Lire, enregistrer une note, ajouter une idée, déposer un message : exécuté sur le dossier du Drive
// (SIMATIS) ou dans l'espace partagé kDrive (Alpes IA).
export const operationCerveau = (slug: string, operation: OperationCerveau) =>
  sendJson<{
    chemin?: string;
    contenu?: string;
    empreinte?: string;
    lectureSeule?: string | null;
    resultats?: { chemin: string; extraits: string[] }[];
    textes?: Record<string, string>;
  }>('POST', inst(slug, 'cerveau/operations'), operation);
export const fetchConsole = (slug: string) => getJson<ConsoleOS>(inst(slug, 'console'));
export const fetchLimitesIA = () => getJson<LimitesIA>('/api/limites-ia');
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

export type SuspectBase = {
  id: string;
  nom: string;
  entreprise: string;
  fonction: string | null;
  email: string | null;
  telephone: string | null;
};
export const fetchSuspectsBase = (slug: string, q: string) =>
  getJson<SuspectBase[]>(
    `/api/i/${encodeURIComponent(slug)}/base/suspects?q=${encodeURIComponent(q)}`,
  );

export type FicheRadar = {
  id: string;
  entreprise: string;
  nom: string;
  fonction: string | null;
  nbContacts: number;
  dernierContactLe: string | null;
  // Étiquettes de la fiche, dont celle de l'ICP d'où elle vient.
  tags: string[];
  // Date à partir de laquelle la touche suivante de la séquence peut partir ; null si aucune.
  prochaineRelanceLe: string | null;
};
export type ColonneRadar = { total: number; fiches: FicheRadar[] };
export type EtatRadar = {
  aEnrichir: ColonneRadar;
  prets: ColonneRadar;
  contactes: ColonneRadar;
  ontRepondu: ColonneRadar;
  // Affaires ouvertes sans rendez-vous : personnes déjà approchées, reprises dans « Contactés ».
  reprise: {
    total: number;
    fiches: { id: string; nom: string; entreprise: string | null; fonction: string | null }[];
  };
  rdvAccepte: {
    total: number;
    fiches: {
      id: string;
      nom: string;
      entreprise: string | null;
      fonction: string | null;
      oppsOuvertes: number;
    }[];
  };
};
export type ChampCiblage = { cle: string; valeur: string };
// Un ICP de l'Atelier avec son persona et la demande de recherche composée à partir d'eux.
export type CiblageAtelier = {
  atelierId: string;
  atelierTitre: string;
  entreprise: string | null;
  code: string;
  nom: string;
  offre: string;
  icp: ChampCiblage[];
  persona: ChampCiblage[];
  demande: string;
};
export const fetchCiblages = (slug: string) =>
  getJson<CiblageAtelier[]>(inst(slug, 'ateliers-strategie/ciblages'));
export type SequenceFroid = { delais: number[]; cumul: number[] };
export const fetchSequence = (slug: string) =>
  getJson<SequenceFroid>(inst(slug, 'prospection/sequence'));
export const enregistrerSequence = (slug: string, delais: number[]) =>
  sendJson<SequenceFroid>('PUT', inst(slug, 'prospection/sequence'), { delais });
export const creerAffaireContact = (slug: string, contactId: string) =>
  sendJson<{ id?: string; simulation?: boolean; message?: string }>(
    'POST',
    inst(slug, `contacts/${encodeURIComponent(contactId)}/affaire`),
    {},
  );
export const fetchRadar = (slug: string) => getJson<EtatRadar>(inst(slug, 'radar'));

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
    telephone?: string;
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
  secondeBoite: boolean;
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
export type InvitationVue = {
  id: string;
  lien: string;
  email: string | null;
  creeeLe: string;
  expireLe: string;
};
export type PartenairesReponse = {
  actif: boolean;
  porteuse: boolean;
  ecrituresReelles: boolean;
  inscrit: boolean;
  peutInviter: boolean;
  objets: ObjetCrm[];
  champsExcluables: { cle: string; libelle: string }[];
  niveaux: { id: PartenaireVue['niveau']; libelle: string }[];
  gardeFous: string[];
  partenaires: PartenaireVue[];
  invitations: InvitationVue[];
  missions: MissionVue[];
};
export const fetchPartenaires = (slug: string) =>
  getJson<PartenairesReponse>(inst(slug, 'partenaires'));
export const inviterPartenaire = (slug: string, email: string) =>
  sendJson<{ invitation: InvitationVue }>('POST', inst(slug, 'partenaires/invitations'), {
    email,
  });
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
export const demarrerGoogleLecture = (slug: string) =>
  sendJson<{ url: string }>('POST', inst(slug, 'connexions/google/start-lecture'), {});
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
  // Ouverte sans aucun rendez-vous : une personne encore en prospection, suivie aussi dans le Radar.
  sansRdv: boolean;
  // Prochain rendez-vous commercial lié à l'affaire, à son contact ou à son entreprise.
  prochainRdv: string | null;
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
  // Réponse rédigée par la routine, à relire puis à valider dans la messagerie.
  reponsePreparee: {
    objet: string | null;
    texte: string;
    lienBrouillon: string | null;
    prepareeLe: string;
  } | null;
  // Compte rendu rédigé par la routine pour une entrée « compte rendu », à relire.
  compteRenduPrepare: { texte: string; prepareeLe: string } | null;
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
export type MoteurIA = 'claude' | 'codex';
export type Options = { ensuite: boolean; moteurIA: MoteurIA };
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
  compte?: string;
  mail?: {
    fil: string;
    objet: string;
    de: string | null;
    a: string | null;
    cc?: string | null;
    sens: 'envoye' | 'recu';
    reponse: boolean;
    lien?: string;
    html?: string;
    corps?: string;
    charge?: boolean;
  };
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
  testsVma?: { id: string; nom: string; date: string | null }[];
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
// Mails exchanged with the record, read from the instance's mailbox (apart from the card: slow).
export type MailsFiche = { mails: Evenement[]; adresses: number; message?: string };
export const fetchMailsFiche = (slug: string, kind: KindFiche, id: string, message?: string) =>
  getJson<MailsFiche>(
    `${fiche(slug, kind, id)}/mails${message ? `?message=${encodeURIComponent(message)}` : ''}`,
  );
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
export const modifierNoteFiche = (
  slug: string,
  kind: KindFiche,
  id: string,
  noteId: string,
  corps: string,
) =>
  sendJson<FicheDetail | SimulationTache>(
    'PATCH',
    `${fiche(slug, kind, id)}/notes/${encodeURIComponent(noteId)}`,
    { corps },
  );
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
    | 'revue_exporter'
    | 'dossier_exporter'
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
  rapportLiens: { lien: string; le: string; version?: number; finale?: boolean }[];
  rapportVersions: { version: number; le: string }[];
  // Export de la revue validée en artifact claude.ai, à rouvrir dans Claude Chat.
  revueExportStatut: 'aucun' | 'en_cours' | 'pret';
  revueExportLien: string | null;
  // Dossier de travail du rapport en artifact claude.ai, à rouvrir dans Claude Chat.
  dossierExportStatut: 'aucun' | 'en_cours' | 'pret';
  dossierExportLien: string | null;
  restitutionStatut: 'aucun' | 'en_cours' | 'pret';
  restitutionLien: string | null;
  restitutionLiens: { lien: string; le: string; finale?: boolean }[];
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
// Version finale du rapport : le Google Doc coché sert de référence pour rédiger les suivants.
export const marquerRapportFinal = (slug: string, id: string, lien: string, finale: boolean) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/rapport/finale`),
    { lien, finale },
  );
// Réglage du module Diagnostic : relire les deux derniers rapports finaux avant de rédiger.
export type ReglagesDiag = {
  relireFinaux: boolean;
  relireSupports: boolean;
  relireRestitutions: boolean;
};
export const reglagesDiagnostic = (slug: string) =>
  getJson<ReglagesDiag>(inst(slug, 'diagnostic/reglages'));
export const majReglagesDiagnostic = (slug: string, reglage: Partial<ReglagesDiag>) =>
  sendJson<ReglagesDiag>('PUT', inst(slug, 'diagnostic/reglages'), reglage);
// Préparation de la revue par Claude (étape 3) : il propose des textes, le pilote garde ses choix.
export const preparerRevueDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/revue/preparer`),
    {},
  );
// Export de la revue validée en artifact (étape 3) : Claude le crée, le lien s'ouvre dans Claude Chat.
export const exporterRevueDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/revue/exporter`),
    {},
  );
// Dossier de travail du rapport en artifact (étape 4) : Claude le crée, le lien s'ouvre dans Claude Chat.
export const preparerDossierRapportDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/rapport/dossier`),
    {},
  );
// Capitalisation des règles à partir de la revue validée (étape 3).
export const capitaliserAnalyseDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/revue/capitaliser`),
    {},
  );
// Capitalisation des règles à partir du support final archivé (étape 1).
export const capitaliserSupportDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/support/capitaliser`),
    {},
  );
// Règles de rédaction apprises (journal), capitalisation à la demande et annulation d'une règle.
export type EntreeReglesDiag = {
  id: string;
  le: string;
  projetId: string;
  fiche: 'rapport' | 'communes' | 'support' | 'analyse';
  action: 'ajoutée' | 'durcie' | 'modifiée' | 'signalée' | 'annulée';
  libelle: string;
  avant: string | null;
  apres: string | null;
  origine: string;
  statut: 'actif' | 'annule';
  motifRefus: string | null;
};
export const journalReglesDiag = (slug: string) =>
  getJson<EntreeReglesDiag[]>(inst(slug, 'diagnostic/regles-journal'));
export const capitaliserRapportDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/rapport/capitaliser`),
    {},
  );
export const marquerDeckFinalDiag = (slug: string, id: string, lien: string, finale: boolean) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/restitution/finale`),
    { lien, finale },
  );
export const capitaliserDeckDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/restitution/regles`),
    {},
  );
export const annulerRegleDiag = (slug: string, id: string, entree: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(
      slug,
      `diagnostic/projets/${encodeURIComponent(id)}/regles-journal/${encodeURIComponent(entree)}/annuler`,
    ),
    {},
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
// Cadrage du rapport (étape 4) : Claude pose ses questions et propose le plan avant la production.
export const cadrerRapportDiag = (slug: string, id: string) =>
  sendJson<ProjetDiag>(
    'POST',
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/rapport/cadrer`),
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
// Diapositives du dernier export de la restitution, pour les présenter dans l'OS.
export const fetchDiapositivesRestitution = (slug: string, id: string) =>
  getJson<{ nom: string; diapositives: Diapositive[] }>(
    inst(slug, `diagnostic/projets/${encodeURIComponent(id)}/restitution/diapositives`),
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
  linkedin?: string | null;
  id: string;
  zone: ZoneBase;
  entreprise: string;
  civilite: 'M.' | 'Mme' | null;
  prenom: string | null;
  // Empty while the record only knows its company (« à enrichir »).
  nom: string;
  email: string | null;
  emailEntreprise?: string | null;
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
  entrepriseId?: string | null;
  tags?: string[];
  alertes: { code: string; libelle: string; bloquante: boolean }[];
};
export type StatutProspectionBase = 'jamais_contacte' | 'contacte' | 'a_repondu';
export type ExclusionBase = 'client' | 'partenaire' | 'concurrent';
export type AlerteBase =
  'recontact' | 'opposition' | 'email_invalide' | 'exclusion' | 'deja_en_crm';
export type FiltresBaseWeb = {
  tri?: 'entreprise' | 'tentatives' | 'dernier_contact';
  canal?: 'email' | 'linkedin';
  zone?: ZoneBase;
  statut?: StatutProspectionBase;
  alerte?: AlerteBase;
  provenance?: string;
  liste?: string;
  tag?: string;
  q?: string;
};
export type ResumeListeBase = {
  id: string;
  nom: string;
  type: 'contacts' | 'entreprises';
  mandat: string | null;
  nombre: number;
};
export type EtatBase = {
  fiches: FicheBase[];
  total: number;
  compteurs: { aEnrichir: number; prospectable: number; total?: number };
  provenances: string[];
  listes: ResumeListeBase[];
  tags: string[];
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
export type ApercuWaalaxy = {
  retenues: number;
  parties: number;
  ecartees: { opposition: number; exclusion: number; sansProfil: number; alerte: number };
  nonVerifiees: number;
};
export const fetchApercuWaalaxy = (slug: string, filtres: FiltresBaseWeb = {}) => {
  const suite = paramsBase(filtres).toString();
  return getJson<ApercuWaalaxy>(inst(slug, `base/export-waalaxy${suite ? `?${suite}` : ''}`));
};
export const urlExportWaalaxy = (slug: string, filtres: FiltresBaseWeb, partie: number) => {
  const params = paramsBase(filtres);
  params.set('partie', String(partie));
  return inst(slug, `base/export-waalaxy.csv?${params.toString()}`);
};
export const actualiserHistoriqueBase = (slug: string) =>
  sendJson<{ verifiees: number; trouvees: number }>(
    'POST',
    inst(slug, 'base/historique/actualiser'),
    {},
  );
export const supprimerFichesBase = (slug: string, ids: string[]) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, 'base/fiches'), { ids });
export type SecteurWeb = { code: string; libelle: string };
export type CriteresWeb = {
  q?: string;
  secteurs: SecteurWeb[];
  departements: string[];
  effectifs: string[];
  categories: string[];
  caMin?: number;
  caMax?: number;
};
export type ResultatEntrepriseWeb = EntrepriseAnnuaireWeb & {
  finances: { annee: number; ca: number | null; resultat: number | null }[];
};
export type PageEntreprisesWeb = {
  resultats: ResultatEntrepriseWeb[];
  total: number;
  pages: number;
  page: number;
  dejaDansLaBase: string[];
};
export const interpreterEntreprisesBase = (slug: string, demande: string) =>
  sendJson<{ criteres: CriteresWeb; nonTraites: string[]; resume: string }>(
    'POST',
    inst(slug, 'base/entreprises/interpreter'),
    { demande },
  );
export const rechercherEntreprisesBase = (slug: string, criteres: CriteresWeb, page = 1) =>
  sendJson<PageEntreprisesWeb>('POST', inst(slug, 'base/entreprises/recherche'), {
    criteres,
    page,
  });
export const ajouterEntreprisesBase = (
  slug: string,
  sirens: string[],
  liste?: string,
  etiquette?: string,
) =>
  sendJson<{ ajoutees: number; existantes: number; introuvables: number }>(
    'POST',
    inst(slug, 'base/entreprises/ajouter'),
    { sirens, liste, etiquette },
  );
export const creerListeBase = (
  slug: string,
  nom: string,
  mandat?: string | null,
  type: 'contacts' | 'entreprises' = 'contacts',
) => sendJson<ResumeListeBase>('POST', inst(slug, 'base/listes'), { nom, mandat, type });
export type LigneEntrepriseBase = {
  id: string;
  siren: string;
  nom: string;
  ville: string | null;
  departement: string | null;
  naf: string | null;
  effectif: string | null;
  categorie: string | null;
  ca: number | null;
  nbContacts: number;
  listes: string[];
  signal: { gravite: GraviteSignal; nature: string; date: string } | null;
  signauxLe: string | null;
  siteWeb: string | null;
  standard: string | null;
};
export type GraviteSignal = 'alerte' | 'attention' | 'info';
export type SignalWeb = {
  id: string;
  date: string;
  famille: string;
  nature: string;
  gravite: GraviteSignal;
  detail: string | null;
  url: string | null;
};
export type SignauxWeb = { signaux: SignalWeb[]; verifieLe: string | null };
export const fetchSignauxEntreprise = (slug: string, id: string) =>
  getJson<SignauxWeb>(inst(slug, `base/entreprises/${id}/signaux`));
export const actualiserSignauxEntreprise = (slug: string, id: string) =>
  sendJson<SignauxWeb & { nouveaux: number }>(
    'POST',
    inst(slug, `base/entreprises/${id}/signaux/actualiser`),
    {},
  );
export const actualiserSignauxPlusieurs = (slug: string, ids: string[]) =>
  sendJson<{ verifiees: number; nouveaux: number; echecs: number }>(
    'POST',
    inst(slug, 'base/entreprises/signaux/actualiser'),
    { ids },
  );
export type AlerteSignauxWeb = {
  active: boolean;
  heure: string;
  dernierJour?: string;
  bilan?: string;
};
export const lireAlerteSignaux = (slug: string) =>
  getJson<AlerteSignauxWeb>(inst(slug, 'base/signaux/routine'));
export const enregistrerAlerteSignaux = (
  slug: string,
  reglages: { active: boolean; heure: string },
) => sendJson<AlerteSignauxWeb>('PUT', inst(slug, 'base/signaux/routine'), reglages);
export const lancerAlerteSignaux = (slug: string) =>
  sendJson<{
    verifiees: number;
    nouveaux: number;
    deposes: number;
    echecs: number;
    bilan: string;
  }>('POST', inst(slug, 'base/signaux/routine/lancer'), {});
export const fetchEntreprisesBase = (
  slug: string,
  { q, liste, signal, page }: { q?: string; liste?: string; signal?: string; page?: number },
) => {
  const params = new URLSearchParams();
  if (q?.trim()) params.set('q', q.trim());
  if (liste) params.set('liste', liste);
  if (signal) params.set('signal', signal);
  if (page) params.set('page', String(page));
  const suite = params.toString();
  return getJson<{ entreprises: LigneEntrepriseBase[]; total: number }>(
    inst(slug, `base/entreprises${suite ? `?${suite}` : ''}`),
  );
};
export type PointCarteWeb = {
  id: string;
  siren: string;
  nom: string;
  ville: string | null;
  latitude: number;
  longitude: number;
  nbContacts: number;
};
export const fetchCarteEntreprises = (
  slug: string,
  { q, liste }: { q?: string; liste?: string },
) => {
  const params = new URLSearchParams();
  if (q?.trim()) params.set('q', q.trim());
  if (liste) params.set('liste', liste);
  const suite = params.toString();
  return getJson<{ points: PointCarteWeb[]; sansCoordonnees: number; total: number }>(
    inst(slug, `base/entreprises/carte${suite ? `?${suite}` : ''}`),
  );
};
export type EtapeTourneeWeb = {
  id: string | null;
  nom: string;
  ville: string | null;
  adresse: string | null;
  latitude: number;
  longitude: number;
  distanceM: number;
  dureeS: number;
};
export type TourneeWeb = {
  etapes: EtapeTourneeWeb[];
  distanceM: number;
  dureeS: number;
  trace: [number, number][];
  source: 'routes' | 'estimation';
  ignorees: string[];
};
export const calculerTourneeBase = (slug: string, ids: string[], depart?: string) =>
  sendJson<TourneeWeb>('POST', inst(slug, 'base/tournee'), { ids, depart: depart || undefined });
export const ajouterEntreprisesALaListeBase = (slug: string, id: string, ids: string[]) =>
  sendJson<{ ajoutees: number }>('POST', inst(slug, `base/listes/${id}/entreprises`), { ids });
export const retirerEntreprisesDeLaListeBase = (slug: string, id: string, ids: string[]) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `base/listes/${id}/entreprises`), { ids });
export const majListeBase = (
  slug: string,
  id: string,
  patch: { nom?: string; mandat?: string | null },
) => sendJson<{ ok: true }>('PATCH', inst(slug, `base/listes/${id}`), patch);
export const supprimerListeBase = (slug: string, id: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `base/listes/${id}`), {});
export const ajouterALaListeBase = (slug: string, id: string, ids: string[]) =>
  sendJson<{ ajoutees: number }>('POST', inst(slug, `base/listes/${id}/fiches`), { ids });
export const retirerDeLaListeBase = (slug: string, id: string, ids: string[]) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `base/listes/${id}/fiches`), { ids });
export const etiqueterBase = (
  slug: string,
  ids: string[],
  etiquettes: { ajouter?: string[]; retirer?: string[] },
) => sendJson<{ ok: true }>('POST', inst(slug, 'base/tags'), { ids, ...etiquettes });
export type EntrepriseAnnuaireWeb = {
  siren: string;
  nom: string;
  naf: string | null;
  categorie: string | null;
  effectif: string | null;
  adresse: string | null;
  ville: string | null;
  active: boolean;
};
export type EntrepriseBaseWeb = EntrepriseAnnuaireWeb & {
  id: string;
  formeJuridique: string | null;
  creeLe: string | null;
  oppositionDiffusion: boolean;
  etablissementsOuverts: number | null;
  siteWeb: string | null;
  siteTelephones: string[];
  siteEmails: string[];
  linkedin: string | null;
  siteConfirme: boolean;
  siteLuLe: string | null;
  finances: { annee: number; ca: number | null; resultat: number | null }[];
  dirigeants: { nom: string; fonction: string | null; societe: boolean }[];
};
export const fetchCandidatsEntreprise = (slug: string, ficheId: string) =>
  getJson<{ candidats: EntrepriseAnnuaireWeb[] }>(
    inst(slug, `base/fiches/${ficheId}/entreprise/candidats`),
  );
export const rattacherEntrepriseBase = (slug: string, ficheId: string, siren: string) =>
  sendJson<{ entreprise: EntrepriseBaseWeb; rattachees: number }>(
    'POST',
    inst(slug, `base/fiches/${ficheId}/entreprise`),
    { siren },
  );
export const detacherEntrepriseBase = (slug: string, ficheId: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `base/fiches/${ficheId}/entreprise`), {});
export const lireSiteEntrepriseBase = (slug: string, id: string, url?: string) =>
  sendJson<EntrepriseBaseWeb>(
    'POST',
    inst(slug, `base/entreprises/${id}/site`),
    url ? { url } : {},
  );
export const fetchEntrepriseBase = (slug: string, id: string) =>
  getJson<EntrepriseBaseWeb>(inst(slug, `base/entreprises/${id}`));
export const majConformiteBase = (
  slug: string,
  id: string,
  patch: { opposition?: boolean; exclusion?: ExclusionBase | null; emailInvalide?: boolean },
) => sendJson<{ ok: true }>('PATCH', inst(slug, `base/fiches/${id}`), patch);
export type RoutineBrouillonsVue = {
  active: boolean;
  heure: string;
  dernierJour?: string;
  bilan?: string;
};
export const lireRoutineBrouillons = (slug: string) =>
  getJson<RoutineBrouillonsVue>(inst(slug, 'prospection/routine'));
export const sauverRoutineBrouillons = (slug: string, { active, heure }: RoutineBrouillonsVue) =>
  sendJson<RoutineBrouillonsVue>('PUT', inst(slug, 'prospection/routine'), { active, heure });

export type RoutineProspectsVue = {
  active: boolean;
  consignes: string;
  nombre: number;
  heure: string;
  dernierJour?: string;
  bilan?: string;
};

export const lireRoutineProspects = (slug: string) =>
  getJson<RoutineProspectsVue>(inst(slug, 'base/recherche/routine'));

export const sauverRoutineProspects = (
  slug: string,
  { active, consignes, nombre, heure }: RoutineProspectsVue,
) =>
  sendJson<RoutineProspectsVue>('PUT', inst(slug, 'base/recherche/routine'), {
    active,
    consignes,
    nombre,
    heure,
  });

export type ProspectRecherche = {
  entreprise: string;
  prenom: string;
  nom: string;
  fonction: string;
  email: string | null;
  linkedin: string | null;
  source: string;
  qualification: string;
};

export const rechercherProspectsBase = (slug: string, consignes: string, nombre: number) =>
  sendJson<ProspectRecherche[]>('POST', inst(slug, 'base/recherche'), { consignes, nombre });

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
  linkedin?: string;
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
  envoyes?: number;
  resultat: ResultatCampagne | null;
};
export type VueProspection = {
  stats: StatsProspection;
  signatures: SignatureProspection[];
  recentes: CampagneResume[];
  enCours: string | null;
  nbEnCours: number;
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
  // Demande de reformulation en attente de Claude (le mail est alors `a_rediger`).
  consigne: string | null;
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
export const reformulerBrouillonCampagne = (
  slug: string,
  campagneId: string,
  brouillonId: string,
  consigne: string,
) =>
  sendJson<{ ok: true }>(
    'POST',
    inst(
      slug,
      `prospection/campagnes/${encodeURIComponent(campagneId)}/brouillons/${encodeURIComponent(brouillonId)}/reformuler`,
    ),
    { consigne },
  );
// Même demande pour plusieurs mails d'un coup (`ids`), ou pour tous ceux qui peuvent l'être.
export const reformulerBrouillonsCampagne = (
  slug: string,
  campagneId: string,
  consigne: string,
  ids?: string[],
) =>
  sendJson<{ reformules: number }>(
    'POST',
    inst(slug, `prospection/campagnes/${encodeURIComponent(campagneId)}/reformuler`),
    { consigne, ...(ids ? { ids } : {}) },
  );
export const abandonnerCampagne = (slug: string, id: string) =>
  sendJson<{ abandonnees: number }>(
    'DELETE',
    inst(slug, `prospection/campagnes/${encodeURIComponent(id)}`),
    {},
  );
export const abandonnerCampagnesEnCours = (slug: string) =>
  sendJson<{ abandonnees: number }>('DELETE', inst(slug, 'prospection/campagnes-en-cours'), {});
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

// Gestion (Mon activité) : dépenses, occurrences et synthèse du mois.
export type AffectationGestion = { cible: 'simatis' | 'kairos' | 'mandat'; mandat?: string };
export type OccurrenceDepense = {
  depenseId: string;
  cle: string;
  libelle: string;
  categorie: string | null;
  date: string;
  montantTtcCents: number;
  etat: 'payee' | 'a_venir' | 'ignoree';
  statut: 'reelle' | 'prevue';
  recurrente: boolean;
  payeur: 'societe' | 'associe';
  affectations: AffectationGestion[];
  refacturable: boolean;
  justificatif: string | null;
  refacturablePrevuCents: number;
  refactureCents: number;
};
export type SyntheseDepenses = {
  mois: string;
  payeCents: number;
  aVenirCents: number;
  totalCents: number;
  parMois12: { mois: string; cents: number }[];
  recurrentMensuelCents: number;
};
export type DepenseGestion = {
  id: string;
  libelle: string;
  categorie: string | null;
  montantTtcCents: number;
  tvaCents: number | null;
  statut: 'reelle' | 'prevue';
  recurrence: 'aucune' | 'mensuelle' | 'trimestrielle' | 'annuelle';
  dateDebut: string;
  dateFin: string | null;
  payeur: 'societe' | 'associe';
  affectations: AffectationGestion[];
  refacturable: boolean;
  justificatif: string | null;
  // Recettes liées (refacturations) : présentes seulement sur la lecture d'une dépense.
  refacturations?: { id: string; mandat: string | null; montantHtCents: number }[];
};
export type NouvelleDepense = Omit<DepenseGestion, 'id' | 'refacturations'>;
export const fetchDepenses = (slug: string, mois: string) =>
  getJson<{ synthese: SyntheseDepenses; occurrences: OccurrenceDepense[] }>(
    inst(slug, `gestion/depenses?mois=${mois}`),
  );
export const creerDepenseGestion = (slug: string, d: NouvelleDepense) =>
  sendJson<DepenseGestion>('POST', inst(slug, 'gestion/depenses'), d);
export const modifierDepenseGestion = (slug: string, id: string, d: Partial<NouvelleDepense>) =>
  sendJson<DepenseGestion>('PATCH', inst(slug, `gestion/depenses/${id}`), d);
export const archiverDepenseGestion = (slug: string, id: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `gestion/depenses/${id}`), {});
export const occurrenceDepenseGestion = (
  slug: string,
  id: string,
  date: string,
  corps: {
    portee?: 'cette' | 'suivantes';
    etat?: 'payee' | 'ignoree';
    datePaiement?: string | null;
    montantTtcCents?: number | null;
    serie?: Partial<NouvelleDepense>;
  },
) =>
  sendJson<DepenseGestion>('PUT', inst(slug, `gestion/depenses/${id}/occurrences/${date}`), corps);
export const reinitialiserOccurrenceGestion = (slug: string, id: string, date: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `gestion/depenses/${id}/occurrences/${date}`), {});
export const fetchDepenseGestion = (slug: string, id: string) =>
  getJson<DepenseGestion>(inst(slug, `gestion/depenses/${id}`));

// Recettes (CA en HT) : ponctuelles ou récurrentes, refacturations liées à une dépense.
export type RevenuGestion = {
  id: string;
  libelle: string;
  type: 'commission' | 'abonnement' | 'refacturation' | 'autre';
  mandat: string | null;
  montantHtCents: number;
  etat: 'prevue' | 'emise' | 'encaissee';
  date: string;
  dateEncaissement: string | null;
  referenceFacture: string | null;
  tvaCents: number | null;
  recurrence: 'aucune' | 'mensuelle' | 'trimestrielle' | 'annuelle';
  dateFin: string | null;
  certitude: 'certaine' | 'probable' | 'hypothese';
  depenseId: string | null;
};
export type NouveauRevenu = Omit<RevenuGestion, 'id'>;
export type OccurrenceRevenu = {
  revenuId: string;
  cle: string;
  libelle: string;
  type: RevenuGestion['type'];
  mandat: string | null;
  certitude: RevenuGestion['certitude'];
  date: string;
  dateEncaissement: string | null;
  montantHtCents: number;
  etat: 'prevue' | 'emise' | 'encaissee' | 'ignoree';
  referenceFacture: string | null;
  recurrente: boolean;
  depenseId: string | null;
};
export type SyntheseRevenus = {
  mois: string;
  aEncaisserCertainCents: number;
  aEncaisserIncertainCents: number;
  encaisseCents: number;
  parMandat: {
    mandat: string | null;
    totalCents: number;
    aFacturerCents: number;
    parType: Partial<Record<RevenuGestion['type'], number>>;
  }[];
};
export const fetchRevenus = (slug: string, mois: string) =>
  getJson<{ synthese: SyntheseRevenus; revenus: OccurrenceRevenu[] }>(
    inst(slug, `gestion/revenus?mois=${mois}`),
  );
export const fetchRevenuGestion = (slug: string, id: string) =>
  getJson<RevenuGestion>(inst(slug, `gestion/revenus/${id}`));
export const fetchFacturesAEmettre = (slug: string, jusqua: string) =>
  getJson<OccurrenceRevenu[]>(inst(slug, `gestion/factures-a-emettre?jusqua=${jusqua}`));
export type SorteLigneFacture = 'recurrent' | 'commission' | 'frais' | 'ik';
export type LigneFacture = {
  cle: string;
  sorte: SorteLigneFacture;
  libelle: string;
  date: string;
  montantHtCents: number | null;
  tvaCents: number | null;
  certitude: 'certaine' | 'probable' | 'hypothese' | null;
  avertissement: string | null;
};
export type FactureAEmettre = {
  mandat: string;
  emissionPrevue: string;
  delaiJours: number | null;
  delaiMandatJours: number | null;
  encaissementAttendu: string | null;
  totalHtCents: number;
  lignes: LigneFacture[];
  avertissements: string[];
};
export type FacturesAEmettre = { factures: FactureAEmettre[]; sansMandat: LigneFacture[] };
export type LigneFigee = {
  cle: string;
  sorte: SorteLigneFacture;
  libelle: string;
  date: string;
  montantHtCents: number;
  tvaCents: number | null;
};
export type FactureEmise = {
  id: string;
  mandat: string;
  numero: string;
  dateEmission: string;
  delaiJours: number | null;
  totalHtCents: number;
  etat: 'emise' | 'encaissee';
  dateEncaissement: string | null;
  lignes: LigneFigee[];
};
export type EmissionFacture = {
  mandat: string;
  numero: string;
  dateEmission: string;
  exclure: string[];
};
export const fetchFacturesEmises = (slug: string) =>
  getJson<FactureEmise[]>(inst(slug, 'gestion/factures/emises'));
export const emettreFacture = (slug: string, e: EmissionFacture) =>
  sendJson<FactureEmise>('POST', inst(slug, 'gestion/factures/emettre'), e);
export const encaisserFacture = (slug: string, id: string, dateEncaissement: string) =>
  sendJson<FactureEmise>('POST', inst(slug, `gestion/factures/${id}/encaisser`), {
    dateEncaissement,
  });
export const fetchFactures = (slug: string) =>
  getJson<FacturesAEmettre>(inst(slug, 'gestion/factures'));
export const poserDelaiMandat = (slug: string, mandat: string, delaiPaiementJours: number | null) =>
  sendJson<{ ok: true }>('PUT', inst(slug, `gestion/mandats/${mandat}/reglages`), {
    delaiPaiementJours,
  });
export const creerRevenuGestion = (slug: string, r: Partial<NouveauRevenu>) =>
  sendJson<RevenuGestion>('POST', inst(slug, 'gestion/revenus'), r);
export const modifierRevenuGestion = (slug: string, id: string, r: Partial<NouveauRevenu>) =>
  sendJson<RevenuGestion>('PATCH', inst(slug, `gestion/revenus/${id}`), r);
export const archiverRevenuGestion = (slug: string, id: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `gestion/revenus/${id}`), {});
export const occurrenceRevenuGestion = (
  slug: string,
  id: string,
  date: string,
  corps: {
    portee?: 'cette' | 'suivantes';
    etat?: 'emise' | 'encaissee' | 'ignoree';
    dateEncaissement?: string | null;
    montantHtCents?: number | null;
    referenceFacture?: string | null;
    serie?: Partial<NouveauRevenu>;
  },
) => sendJson<RevenuGestion>('PUT', inst(slug, `gestion/revenus/${id}/occurrences/${date}`), corps);
export const reinitialiserOccurrenceRevenu = (slug: string, id: string, date: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `gestion/revenus/${id}/occurrences/${date}`), {});

// Trésorerie, réglages et TVA (Lot C).
export type ReglagesGestion = {
  soldeCents: number | null;
  soldeDate: string | null;
  soldeSource: string | null;
  seuilMode: 'aucun' | 'montant' | 'bfr';
  seuilCents: number | null;
  delaiPaiementJours: number | null;
  scenarios: Record<ScenarioTresorerie, ConfigScenarioTresorerie>;
  remuneration: RemunerationGestion | null;
};
export type ScenarioTresorerie = 'securise' | 'central' | 'ambitieux';
export type CertitudeTresorerie = 'certaine' | 'probable' | 'hypothese';
// Ce que retient un scénario : les prévisions de recettes selon leur certitude, et le pipe.
export type ConfigScenarioTresorerie = {
  certitudes: CertitudeTresorerie[];
  pipe: 'aucun' | 'pondere' | 'total' | 'chaud';
};
export type RemunerationGestion = {
  actif: boolean;
  base: 'brut' | 'net' | 'cout';
  montantCents: number;
  tauxSalarial: number;
  tauxPatronal: number;
  periodicite: 'mensuelle' | 'trimestrielle';
};
export type MouvementTresorerie = {
  date: string;
  sens: 'entree' | 'sortie';
  libelle: string;
  montantCents: number;
  nature: 'depense' | 'recette';
  ref: string;
  estime: boolean;
  note: string | null;
};
export type PeriodeTresorerie = {
  debut: string;
  fin: string;
  entreesCents: number;
  sortiesCents: number;
  soldeFinCents: number | null;
  variationCumuleeCents: number;
  mouvements: MouvementTresorerie[];
};
// Affaire ouverte du Pipeline vue par la trésorerie ; `statut` dit pourquoi elle est écartée.
export type AffairePipe = {
  id: string;
  titre: string;
  entreprise: string | null;
  probabilite: number | null;
  totalCents: number;
  recurrent: boolean;
  mensuelCents: number | null;
  dureeMois: number;
  signature: string | null;
  surcharge: boolean;
  statut: 'comptee' | 'sans_date' | 'sans_montant' | 'sans_probabilite';
};
export type ProjectionTresorerie = {
  aujourdhui: string;
  granularite: 'mois' | 'semaine';
  reglages: ReglagesGestion;
  seuil: {
    mode: ReglagesGestion['seuilMode'];
    cents: number | null;
    bfr: {
      creancesCents: number;
      dettesCents: number;
      bfrCents: number;
      seuilCents: number;
      limites: string[];
    } | null;
  };
  scenarios: {
    scenario: 'securise' | 'central' | 'ambitieux';
    periodes: PeriodeTresorerie[];
    alerte: { debut: string; soldeFinCents: number } | null;
  }[];
  pipe: { affaires: AffairePipe[]; decalageMois: number };
  remuneration: {
    brutCents: number;
    netCents: number;
    salarialCents: number;
    patronalCents: number;
    urssafCents: number;
    coutCents: number;
    inclus: boolean;
  } | null;
  avertissements: string[];
};
export type SuiviTvaGestion = {
  mois: string;
  declaration: 'mensuelle';
  exigibilite: 'a_confirmer';
  collecteeCents: number;
  deductibleCents: number;
  estimeeCents: number;
  lignesSansTva: { recettes: number; depenses: number };
  recettesIncertainesExclues: number;
  declaree: { montantCents: number | null; note: string | null } | null;
  avertissements: string[];
};
// Hypothèses de simulation d'une affaire : montant en euros (mensualité pour un abonnement), probabilité en %.
export type HypothesePipe = { montant?: number | null; probabilite?: number | null };
const hypParam = (h?: Record<string, HypothesePipe>) => {
  const l = Object.entries(h ?? {})
    .filter(([, x]) => x.montant != null || x.probabilite != null)
    .map(([id, x]) => `${id}:${x.montant ?? ''}:${x.probabilite ?? ''}`);
  return l.length ? `&hyp=${l.join(',')}` : '';
};
export const fetchTresorerie = (
  slug: string,
  p: {
    horizon: number;
    granularite: 'mois' | 'semaine';
    retard: number;
    decalage?: number;
    exclus?: string[];
    pipe?: boolean;
    remuneration?: boolean;
    hypotheses?: Record<string, HypothesePipe>;
  },
) =>
  getJson<ProjectionTresorerie>(
    inst(
      slug,
      `gestion/tresorerie?horizon=${p.horizon}&granularite=${p.granularite}&retard=${p.retard}` +
        `&decalage=${p.decalage ?? 0}` +
        (p.exclus?.length ? `&exclus=${p.exclus.join(',')}` : '') +
        (p.pipe === false ? '&pipe=0' : '') +
        (p.remuneration === false ? '&remuneration=0' : '') +
        hypParam(p.hypotheses),
    ),
  );
// Import des transactions bancaires Pennylane (voir src/gestion/import.ts).
export type RapprochementImport = {
  type: 'depense' | 'recette';
  id: string;
  recurrente: boolean;
  dejaCompte: boolean;
  dateOrigine: string;
  libelle: string;
  date: string;
  montantCents: number;
};
export type LigneImportAnalysee = {
  rang: number;
  cle: string;
  date: string;
  libelle: string;
  montantCents: number;
  compte: string;
  sens: 'sortie' | 'entree';
  issue: 'nouvelle' | 'deja' | 'a_verifier';
  raison: string | null;
  rapprochement: RapprochementImport | null;
};
export type AnalyseImport = {
  lignes: LigneImportAnalysee[];
  compteurs: { nouvelles: number; deja: number; aVerifier: number; nonFinalisees: number };
  avertissements: string[];
};
export type DecisionImport = 'importer' | 'rapprocher' | 'ignorer';
export const analyserImport = (slug: string, nomFichier: string, contenuBase64: string) =>
  sendJson<AnalyseImport>('POST', inst(slug, 'gestion/import/analyse'), {
    nomFichier,
    contenuBase64,
  });
export const validerImport = (
  slug: string,
  nomFichier: string,
  contenuBase64: string,
  decisions: Record<string, DecisionImport>,
) =>
  sendJson<{ importees: number; rapprochees: number; ignorees: number }>(
    'POST',
    inst(slug, 'gestion/import/valider'),
    { nomFichier, contenuBase64, decisions },
  );
export const fetchReglagesGestion = (slug: string) =>
  getJson<ReglagesGestion>(inst(slug, 'gestion/reglages'));
export const saveReglagesGestion = (slug: string, r: ReglagesGestion) =>
  sendJson<ReglagesGestion>('PUT', inst(slug, 'gestion/reglages'), r);
export const fetchTva = (slug: string, mois: string) =>
  getJson<SuiviTvaGestion>(inst(slug, `gestion/tva?mois=${mois}`));
export const saveTva = (
  slug: string,
  mois: string,
  s: { declareeCents: number | null; note: string | null },
) => sendJson<SuiviTvaGestion>('PUT', inst(slug, `gestion/tva/${mois}`), s);

// Gestion — IK et compte courant d'associé (Lot D).
export type VehiculeIk = {
  id: string;
  libelle: string;
  categorie: string;
  puissanceFiscale: number | null;
};
export type LieuIk = { id: string; nom: string; distanceKm: number; origine: string };
export type TrancheIk = {
  deKm: number;
  jusquaKm: number | null;
  tauxDixMilliemes: number;
  forfaitCents: number;
};
export type BaremeIk = {
  id: string;
  annee: number;
  categorie: string;
  version: number;
  source: string;
  valideLe: string | null;
  tranches: TrancheIk[];
};
export type ConfigIk = {
  vehicules: VehiculeIk[];
  lieux: LieuIk[];
  baremes: BaremeIk[];
  mois: { mois: string; abonnement: boolean }[];
};
export type StatutIk = 'brouillon' | 'a_controler' | 'valide' | 'comptabilise' | 'rembourse';
export type LigneIk = {
  id: string;
  date: string;
  trajet: string;
  commentaire: string;
  km: number;
  statut: StatutIk;
  cumulKm: number;
  indemniteCents: number | null;
  mandat: string | null;
  refacturer: boolean;
};
export type EtatIk = {
  mois: string;
  vehiculeId: string;
  abonnement: boolean | null;
  bareme: { annee: number; version: number; source: string; valideLe: string } | null;
  lignes: LigneIk[];
  totalKm: number;
  totalIndemniteCents: number | null;
  cumulAnnuelKm: number;
  derniereDateTransmise: string | null;
  cca: { montantCents: number; ecartCents: number } | null;
  avertissements: string[];
};
export type ActionMoisIk = 'a_controler' | 'valide' | 'rouvrir' | 'comptabilise' | 'rembourse';
export type MouvementCca = {
  id: string;
  date: string;
  type: string;
  libelle: string;
  montantCents: number;
  etat: 'prevu' | 'comptabilise';
  source: string | null;
  derive: boolean;
  avantOuverture: boolean;
};
export type SuiviCcaGestion = {
  confirmeCents: number | null;
  estimeCents: number | null;
  ouverture: { date: string; montantCents: number; source: string | null } | null;
  mouvements: MouvementCca[];
  avertissements: string[];
};
export const fetchConfigIk = (slug: string) => getJson<ConfigIk>(inst(slug, 'gestion/ik/config'));
export const fetchEtatIk = (slug: string, mois: string, vehiculeId: string) =>
  getJson<EtatIk>(inst(slug, `gestion/ik/etat?mois=${mois}&vehiculeId=${vehiculeId}`));
export const urlExportIk = (slug: string, mois: string, vehiculeId: string) =>
  inst(slug, `gestion/ik/export.csv?mois=${mois}&vehiculeId=${vehiculeId}`);
export const creerVehiculeIk = (slug: string, v: Omit<VehiculeIk, 'id'>) =>
  sendJson<VehiculeIk>('POST', inst(slug, 'gestion/ik/vehicules'), v);
export const creerLieuIk = (
  slug: string,
  l: { nom: string; distanceKm: number; origine: string },
) => sendJson<LieuIk>('POST', inst(slug, 'gestion/ik/lieux'), l);
export const archiverLieuIk = (slug: string, id: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `gestion/ik/lieux/${id}`), {});
export const creerBaremeIk = (
  slug: string,
  b: { annee: number; categorie: string; source: string; tranches: TrancheIk[] },
) => sendJson<BaremeIk>('POST', inst(slug, 'gestion/ik/baremes'), b);
export const validerBaremeIk = (slug: string, id: string, date: string) =>
  sendJson<BaremeIk>('POST', inst(slug, `gestion/ik/baremes/${id}/valider`), { date });
export const poserAbonnementIk = (slug: string, mois: string, abonnement: boolean) =>
  sendJson<{ ok: true }>('PUT', inst(slug, `gestion/ik/mois/${mois}/abonnement`), { abonnement });
export const creerTrajetIk = (
  slug: string,
  t: {
    vehiculeId: string;
    date: string;
    trajet: string;
    commentaire: string;
    kmAllerRetour: number;
    mandat?: string | null;
    refacturer?: boolean;
  },
) => sendJson<{ id: string }>('POST', inst(slug, 'gestion/ik/trajets'), t);
export const modifierTrajetIk = (
  slug: string,
  id: string,
  patch: { refacturer?: boolean; mandat?: string | null },
) => sendJson<{ id: string }>('PATCH', inst(slug, `gestion/ik/trajets/${id}`), patch);
export const archiverTrajetIk = (slug: string, id: string) =>
  sendJson<{ ok: true }>('DELETE', inst(slug, `gestion/ik/trajets/${id}`), {});
export const avancerMoisIk = (
  slug: string,
  mois: string,
  e: { vehiculeId: string; action: ActionMoisIk; date?: string; source?: string },
) => sendJson<EtatIk>('POST', inst(slug, `gestion/ik/mois/${mois}/avancer`), e);
export const fetchCca = (slug: string) => getJson<SuiviCcaGestion>(inst(slug, 'gestion/cca'));
export const creerMouvementCca = (
  slug: string,
  m: {
    date: string;
    type: string;
    libelle: string;
    montantCents: number;
    etat: 'prevu' | 'comptabilise';
    source: string | null;
  },
) => sendJson<SuiviCcaGestion>('POST', inst(slug, 'gestion/cca/mouvements'), m);
export const comptabiliserMouvementCca = (slug: string, id: string, source: string) =>
  sendJson<SuiviCcaGestion>('POST', inst(slug, `gestion/cca/mouvements/${id}/comptabiliser`), {
    source,
  });
export const archiverMouvementCca = (slug: string, id: string) =>
  sendJson<SuiviCcaGestion>('DELETE', inst(slug, `gestion/cca/mouvements/${id}`), {});

// Dernières sessions de recherche de prospects et d'enrichissement (voir src/enrichissement/sessions.ts).
export type SessionEnrichissement = {
  id: string;
  date: string;
  nature: 'recherche' | 'enrichissement';
  libelle: string;
  mode: 'manuel' | 'automatique';
  etat: 'en_cours' | 'terminee' | 'incomplete' | 'erreur';
  traites: number;
  ajoutees: number | null;
  detail: string | null;
  commentaire: string | null;
};
export type ContactSessionEnrichissement = {
  entreprise: string;
  prenom: string;
  nom: string;
  fonction: string;
  statut: string | null;
};
const urlSession = (slug: string, s: Pick<SessionEnrichissement, 'nature' | 'id'>) =>
  inst(slug, `base/enrichissement-sessions/${s.nature}/${s.id}`);
export const fetchContactsSession = (
  slug: string,
  s: Pick<SessionEnrichissement, 'nature' | 'id'>,
) => getJson<ContactSessionEnrichissement[]>(`${urlSession(slug, s)}/contacts`);
export const commenterSessionEnrichissement = (
  slug: string,
  s: Pick<SessionEnrichissement, 'nature' | 'id'>,
  commentaire: string,
) => sendJson<{ ok: boolean }>('PATCH', urlSession(slug, s), { commentaire });
export const supprimerSessionEnrichissement = (
  slug: string,
  s: Pick<SessionEnrichissement, 'nature' | 'id'>,
) => sendJson<{ ok: boolean }>('DELETE', urlSession(slug, s), {});
export const fetchSessionsEnrichissement = (slug: string) =>
  getJson<SessionEnrichissement[]>(inst(slug, 'base/enrichissement-sessions'));

// Enrichissement de listes par IA (voir src/enrichissement).
export type EtatEnrichissement = {
  disponible: boolean;
  lotMax: number;
  tacheEnCours: string | null;
};
export type TacheEnrichissement = {
  id: string;
  etat: 'en_cours' | 'terminee' | 'interrompue';
  jetons: number;
  erreur: string | null;
};
export type LigneEnrichissement = {
  id: string;
  ficheId: string;
  entreprise: string;
  etat: 'attente' | 'en_cours' | 'terminee' | 'echec' | 'ignoree';
  raison: string | null;
};
export type SuggestionEnrichissement = {
  id: string;
  ficheId: string;
  entreprise: string;
  contactExistant: string | null;
  prenom: string | null;
  nom: string | null;
  fonction: string | null;
  email: string | null;
  emailEntreprise?: string | null;
  telephone: string | null;
  linkedin?: string | null;
  sourceUrl: string | null;
  confiance: 'haute' | 'moyenne' | 'basse';
  modeEmail: 'trouve' | 'deduit' | null;
  etat: 'a_valider' | 'acceptee' | 'refusee';
};
export type LancementEnrichissement = {
  type: 'contacts' | 'completer';
  profil: string[];
  maxParEntreprise: number;
  ficheIds: string[];
};
export const etatEnrichissement = (slug: string) =>
  getJson<EtatEnrichissement>(inst(slug, 'base/enrichissement'));
export const lancerEnrichissement = (slug: string, p: LancementEnrichissement) =>
  sendJson<TacheEnrichissement>('POST', inst(slug, 'base/enrichissement'), p);
export const lireEnrichissement = (slug: string, tacheId: string) =>
  getJson<{ tache: TacheEnrichissement; lignes: LigneEnrichissement[] }>(
    inst(slug, `base/enrichissement/${tacheId}`),
  );
export const suggestionsEnrichissement = (slug: string, tacheId: string) =>
  getJson<SuggestionEnrichissement[]>(inst(slug, `base/enrichissement/${tacheId}/suggestions`));
export const validerEnrichissement = (
  slug: string,
  tacheId: string,
  accepter: string[],
  refuser: string[],
) =>
  sendJson<{ appliquees: number; creees: number; echecs: number }>(
    'POST',
    inst(slug, `base/enrichissement/${tacheId}/valider`),
    { accepter, refuser },
  );

export type RechercheEnCours = {
  id: string;
  etat: 'en_cours' | 'terminee' | 'a_completer' | 'erreur';
  passage?: number;
  message?: string;
  consignes?: string;
  nombre: number;
  debut: string;
  fin?: string;
  contacts?: ProspectRecherche[];
  erreur?: string;
};
export const lireRechercheProspects = (slug: string) =>
  getJson<RechercheEnCours | null>(inst(slug, 'base/recherche/tache'));
export const lancerRechercheProspects = (slug: string, consignes: string, nombre: number) =>
  sendJson<RechercheEnCours>('POST', inst(slug, 'base/recherche/tache'), { consignes, nombre });
export const effacerRechercheProspects = (
  slug: string,
  id: string,
  bilan?: { ajoutees: number; rapprochees: number },
) => sendJson<{ ok: boolean }>('DELETE', inst(slug, 'base/recherche/tache'), { id, ...bilan });

export const continuerRechercheProspects = (slug: string, consignes?: string) =>
  sendJson<RechercheEnCours>('POST', inst(slug, 'base/recherche/tache/continuer'), { consignes });

export type OrigineContactBase = {
  provenance: string;
  collecteLe: string | null;
  notes: { date: string; origine: string; texte: string; source: string | null }[];
};
export const lireOrigineContactBase = (slug: string, id: string) =>
  getJson<OrigineContactBase>(inst(slug, `base/fiches/${id}/origine`));
export const noterContactsRechercheBase = (slug: string, contacts: ProspectRecherche[]) =>
  sendJson<{ ok: boolean }>('POST', inst(slug, 'base/notes-recherche'), { contacts });
