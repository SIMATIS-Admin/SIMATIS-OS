import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Geocodeur } from '../routage/geocodage.js';
import { MAX_ETAPES, type Point, type Routeur, type Tournee } from '../routage/osrm.js';
import { filtreEntreprises } from './entreprises.js';
import { baseEntreprises } from './schema.js';

export class TourneeRefusee extends Error {}

export type PointCarte = {
  id: string;
  siren: string;
  nom: string;
  ville: string | null;
  latitude: number;
  longitude: number;
  nbContacts: number;
};

const MAX_POINTS = 2000;

// Companies of the base placed on the map: the directory gives the address of the head office,
// geocoded. Those without coordinates cannot be shown and are only counted.
export async function pointsCarte(
  db: Executor,
  instanceId: string,
  criteres: { q?: string; liste?: string },
): Promise<{ points: PointCarte[]; sansCoordonnees: number; total: number }> {
  const filtre = filtreEntreprises(instanceId, criteres);
  const lignes = await withInstance(db, instanceId, (tx) =>
    tx
      .select({
        id: baseEntreprises.id,
        siren: baseEntreprises.siren,
        nom: baseEntreprises.nom,
        ville: baseEntreprises.ville,
        latitude: baseEntreprises.latitude,
        longitude: baseEntreprises.longitude,
        nbContacts: sql<number>`(select count(*)::int from base_vivante v where v.entreprise_id = ${sql.raw('"base_entreprises"."id"')} and trim(v.nom) <> '')`,
      })
      .from(baseEntreprises)
      .where(filtre)
      .orderBy(asc(sql`lower(${baseEntreprises.nom})`))
      .limit(MAX_POINTS),
  );
  const points = lignes.flatMap((l) =>
    l.latitude !== null && l.longitude !== null
      ? [{ ...l, latitude: l.latitude, longitude: l.longitude }]
      : [],
  );
  return { points, sansCoordonnees: lignes.length - points.length, total: lignes.length };
}

export type EtapeCarte = {
  // null for the starting address, which is not a company of the base.
  id: string | null;
  nom: string;
  ville: string | null;
  adresse: string | null;
  latitude: number;
  longitude: number;
  distanceM: number;
  dureeS: number;
};
export type TourneeCarte = Omit<Tournee, 'ordre' | 'etapes'> & {
  etapes: EtapeCarte[];
  ignorees: string[];
};

// The first company (or the starting address, when there is one) is where the day starts; the
// others are put in the best order. Only companies of this instance are looked at.
export async function calculerTournee(
  db: Executor,
  routeur: Routeur,
  geocodeur: Geocodeur,
  instanceId: string,
  { ids, depart }: { ids: string[]; depart?: string },
): Promise<TourneeCarte> {
  const uniques = [...new Set(ids)];
  if (uniques.length > MAX_ETAPES)
    throw new TourneeRefusee(`Une tournée compte ${MAX_ETAPES} étapes au plus.`);
  const lignes = await withInstance(db, instanceId, (tx) =>
    tx
      .select()
      .from(baseEntreprises)
      .where(and(eq(baseEntreprises.instanceId, instanceId), inArray(baseEntreprises.id, uniques))),
  );
  const parId = new Map(lignes.map((l) => [l.id, l]));
  const choisies = uniques.flatMap((id) => (parId.has(id) ? [parId.get(id)!] : []));
  const ignorees = choisies
    .filter((e) => e.latitude === null || e.longitude === null)
    .map((e) => e.nom);
  const localisees = choisies.filter((e) => e.latitude !== null && e.longitude !== null);

  const etapes: Omit<EtapeCarte, 'distanceM' | 'dureeS'>[] = [];
  if (depart?.trim()) {
    const adresse = await geocodeur.adresse(depart);
    if (!adresse) throw new TourneeRefusee('Adresse de départ introuvable.');
    etapes.push({
      id: null,
      nom: adresse.libelle,
      ville: null,
      adresse: adresse.libelle,
      latitude: adresse.latitude,
      longitude: adresse.longitude,
    });
  }
  for (const e of localisees)
    etapes.push({
      id: e.id,
      nom: e.nom,
      ville: e.ville,
      adresse: e.adresse,
      latitude: e.latitude as number,
      longitude: e.longitude as number,
    });
  if (etapes.length < 2) throw new TourneeRefusee('Il faut au moins deux entreprises localisées.');
  if (etapes.length > MAX_ETAPES)
    throw new TourneeRefusee(`Une tournée compte ${MAX_ETAPES} étapes au plus.`);

  const points: Point[] = etapes.map((e) => ({ latitude: e.latitude, longitude: e.longitude }));
  const t = await routeur.tournee(points);
  return {
    etapes: t.ordre.map((i, rang) => ({
      ...(etapes[i] as Omit<EtapeCarte, 'distanceM' | 'dureeS'>),
      distanceM: rang === 0 ? 0 : (t.etapes[rang - 1]?.distanceM ?? 0),
      dureeS: rang === 0 ? 0 : (t.etapes[rang - 1]?.dureeS ?? 0),
    })),
    distanceM: t.distanceM,
    dureeS: t.dureeS,
    trace: t.trace,
    source: t.source,
    ignorees,
  };
}
