import { z } from 'zod';
import type { FetchLike } from '../connecteurs/google/oauth.js';

// OSRM : calcul d'itinéraires sur OpenStreetMap. Le serveur public sert à la démonstration, sans
// clé ni garantie : quand il ne répond pas, la tournée est estimée à vol d'oiseau, et dite telle.
const URL_OSRM = 'https://router.project-osrm.org';
export const MAX_ETAPES = 25;

export type Point = { latitude: number; longitude: number };
export type EtapeTournee = { distanceM: number; dureeS: number };
export type Tournee = {
  // Index of the input points, in the order to visit them (the first one is the start).
  ordre: number[];
  // Leg k goes from the k-th to the (k+1)-th visited point.
  etapes: EtapeTournee[];
  distanceM: number;
  dureeS: number;
  trace: [number, number][];
  source: 'routes' | 'estimation';
};
export type Routeur = { tournee(points: Point[]): Promise<Tournee> };

export function distanceKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Nearest neighbour from the first point. A road is about 1.3 times the straight line, and a
// salesperson averages about 50 km/h between two visits.
export function estimerTournee(points: Point[]): Tournee {
  const reste = points.map((_, i) => i).slice(1);
  const ordre = [0];
  while (reste.length > 0) {
    const ici = points[ordre.at(-1) ?? 0];
    if (!ici) break;
    reste.sort((x, y) => distanceKm(ici, points[x] as Point) - distanceKm(ici, points[y] as Point));
    ordre.push(reste.shift() as number);
  }
  const etapes = ordre.slice(1).map((suivant, k) => {
    const km = distanceKm(points[ordre[k] as number] as Point, points[suivant] as Point) * 1.3;
    return { distanceM: Math.round(km * 1000), dureeS: Math.round((km / 50) * 3600) };
  });
  return {
    ordre,
    etapes,
    distanceM: etapes.reduce((s, e) => s + e.distanceM, 0),
    dureeS: etapes.reduce((s, e) => s + e.dureeS, 0),
    trace: ordre.map((i) => [(points[i] as Point).latitude, (points[i] as Point).longitude]),
    source: 'estimation',
  };
}

const reponse = z.object({
  code: z.string(),
  waypoints: z.array(z.object({ waypoint_index: z.number() })),
  trips: z
    .array(
      z.object({
        distance: z.number(),
        duration: z.number(),
        legs: z.array(z.object({ distance: z.number(), duration: z.number() })),
        geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) }),
      }),
    )
    .min(1),
});

export function creerRouteur({
  fetchFn = fetch,
  attendre = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
}: { fetchFn?: FetchLike; attendre?: (ms: number) => Promise<void> } = {}): Routeur {
  // The public server asks for about one call per second.
  let dernier = 0;
  return {
    async tournee(points) {
      if (points.length < 2) throw new Error('Une tournée demande au moins deux étapes.');
      if (points.length > MAX_ETAPES)
        throw new Error(`Une tournée compte ${MAX_ETAPES} étapes au plus.`);
      try {
        const delai = Math.max(0, 1000 - (Date.now() - dernier));
        if (delai > 0) await attendre(delai);
        dernier = Date.now();
        const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
        const params = new URLSearchParams({
          roundtrip: 'false',
          source: 'first',
          destination: 'any',
          overview: 'full',
          geometries: 'geojson',
          steps: 'false',
        });
        const res = await fetchFn(`${URL_OSRM}/trip/v1/driving/${coords}?${params.toString()}`, {
          method: 'GET',
        });
        if (!res.ok) return estimerTournee(points);
        const lu = reponse.safeParse(await res.json());
        const trip = lu.success && lu.data.code === 'Ok' ? lu.data.trips[0] : undefined;
        if (!lu.success || !trip || lu.data.waypoints.length !== points.length)
          return estimerTournee(points);
        // waypoint_index is the position of each input point in the trip: invert it.
        const ordre = lu.data.waypoints
          .map((w, i) => ({ i, rang: w.waypoint_index }))
          .sort((a, b) => a.rang - b.rang)
          .map((w) => w.i);
        return {
          ordre,
          etapes: trip.legs.map((l) => ({
            distanceM: Math.round(l.distance),
            dureeS: Math.round(l.duration),
          })),
          distanceM: Math.round(trip.distance),
          dureeS: Math.round(trip.duration),
          trace: trip.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          source: 'routes',
        };
      } catch {
        return estimerTournee(points);
      }
    },
  };
}
