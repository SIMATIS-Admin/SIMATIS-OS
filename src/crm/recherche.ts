import type { Executor } from '../db.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
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

export type RechercheMandat = ResultatsRecherche & {
  instance: { slug: string; nom: string; couleur: string | null };
};

const nonVide = (r: ResultatsRecherche) =>
  r.affaires.length + r.personnes.length + r.organisations.length > 0;

// The own instance reads its active mandates (read only). Each one is read in its own isolated
// transaction; one that fails is left out without hiding the others, and its error is not sent.
export async function rechercherMandats(
  db: Executor,
  q: string,
  lire: (
    db: Executor,
    instance: Instance,
    q: string,
  ) => Promise<ResultatsRecherche> = rechercherDans,
): Promise<RechercheMandat[]> {
  if (q.trim().length < 2) return [];
  const mandats = (await listInstances(db)).filter((i) => i.type === 'mandat');
  const lectures = await Promise.allSettled(
    mandats.map(async (m) => ({ m, r: await lire(db, m, q) })),
  );
  return lectures.flatMap((l) =>
    l.status === 'fulfilled' && nonVide(l.value.r)
      ? [
          {
            instance: {
              slug: l.value.m.slug,
              nom: l.value.m.nom,
              couleur: l.value.m.config.couleur ?? null,
            },
            ...l.value.r,
          },
        ]
      : [],
  );
}
