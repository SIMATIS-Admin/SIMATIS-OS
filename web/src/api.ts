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

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Erreur ${response.status} sur ${url}`);
  return (await response.json()) as T;
}

export const fetchInstances = () => getJson<InstanceSummary[]>('/api/instances');

export const fetchEntreprises = (slug: string, q: string) =>
  getJson<Entreprise[]>(
    `/api/i/${encodeURIComponent(slug)}/entreprises?q=${encodeURIComponent(q)}`,
  );

export const fetchContacts = (slug: string, q: string) =>
  getJson<Contact[]>(`/api/i/${encodeURIComponent(slug)}/contacts?q=${encodeURIComponent(q)}`);
