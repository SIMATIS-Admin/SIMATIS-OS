import type { Executor } from '../db.js';
import type { Instance } from '../instances/schema.js';
import { rechercherOpportunites } from './pipeline.js';
import { searchContacts, searchEntreprises } from './service.js';

export type ResultatsRecherche = {
  affaires: { id: string; titre: string; entreprise: string | null; clos: string | null }[];
  personnes: { id: string; nom: string; entreprise: string | null }[];
  organisations: { id: string; nom: string; ville: string | null }[];
};

const VIDE: ResultatsRecherche = { affaires: [], personnes: [], organisations: [] };

// Global search (Pipedrive top bar): a few deals, people and organisations of one instance, read
// in that instance's own isolated transaction.
export async function rechercherDans(
  db: Executor,
  instance: Instance,
  q: string,
): Promise<ResultatsRecherche> {
  const terme = q.trim().slice(0, 100);
  if (terme.length < 2) return VIDE;
  const [affaires, personnes, organisations] = await Promise.all([
    rechercherOpportunites(db, instance, terme),
    searchContacts(db, instance.id, terme),
    searchEntreprises(db, instance.id, terme),
  ]);
  return {
    affaires: affaires.slice(0, 5),
    personnes: personnes
      .slice(0, 5)
      .map((p) => ({ id: p.id, nom: p.nom, entreprise: p.entreprise })),
    organisations: organisations.slice(0, 5).map((o) => ({ id: o.id, nom: o.nom, ville: o.ville })),
  };
}
