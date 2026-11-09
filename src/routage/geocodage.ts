import { z } from 'zod';
import type { FetchLike } from '../connecteurs/google/oauth.js';

// Base Adresse Nationale : le géocodeur officiel des adresses françaises, gratuit et sans clé.
const URL_BAN = 'https://api-adresse.data.gouv.fr/search/';

export type AdresseTrouvee = { latitude: number; longitude: number; libelle: string };
export type Geocodeur = { adresse(texte: string): Promise<AdresseTrouvee | null> };

const reponse = z.object({
  features: z.array(
    z.object({
      properties: z.object({ label: z.string() }),
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
    }),
  ),
});

// A failing service is not an error for the pilot: the address is just not found.
export function creerGeocodeur({ fetchFn = fetch }: { fetchFn?: FetchLike } = {}): Geocodeur {
  return {
    async adresse(texte) {
      const q = texte.trim();
      if (!q) return null;
      try {
        const res = await fetchFn(
          `${URL_BAN}?${new URLSearchParams({ q, limit: '1' }).toString()}`,
          {
            method: 'GET',
          },
        );
        if (!res.ok) return null;
        const lu = reponse.safeParse(await res.json());
        const f = lu.success ? lu.data.features[0] : undefined;
        return f
          ? {
              longitude: f.geometry.coordinates[0],
              latitude: f.geometry.coordinates[1],
              libelle: f.properties.label,
            }
          : null;
      } catch {
        return null;
      }
    },
  };
}
