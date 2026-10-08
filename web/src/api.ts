import type { InstanceSummary } from './nav.js';

export type Entreprise = {
  id: string;
  nom: string;
  secteur: string | null;
  ville: string | null;
  taille: number | null;
  domaine: string | null;
  nbContacts: number;
};

export type Contact = {
  id: string;
  nom: string;
  fonction: string | null;
  email: string | null;
  role: string | null;
  entreprise: string | null;
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
const sendJson = <T>(method: 'PUT' | 'PATCH', url: string, payload: unknown) =>
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
