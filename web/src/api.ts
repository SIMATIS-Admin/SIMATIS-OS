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
  ecrituresReelles: boolean;
};

export const fetchConnexions = (slug: string) =>
  getJson<ConnexionsReponse>(inst(slug, 'connexions'));
export const saveReglagesCrm = (slug: string, reglages: ReglagesCrm) =>
  sendJson<{ reglages: ReglagesCrm }>('PATCH', inst(slug, 'connexions/crm'), reglages);
export const syncConnexion = (slug: string, kind: string) =>
  sendJson<{ lus: number; crees: number; maj: number }>(
    'POST',
    inst(slug, `connexions/${encodeURIComponent(kind)}/sync`),
    {},
  );
