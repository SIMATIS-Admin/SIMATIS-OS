import { describe, expect, it, vi } from 'vitest';
import { creerGeocodeur } from './geocodage.js';
import { creerRouteur, distanceKm, estimerTournee, type Point } from './osrm.js';

const A: Point = { latitude: 45.764, longitude: 4.8357 };
const B: Point = { latitude: 45.7667, longitude: 4.8803 };
const C: Point = { latitude: 45.6976, longitude: 4.887 };

const reponse = (corps: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(corps), { status }));

describe('distance et estimation de tournée', () => {
  it('calcule une distance à vol d’oiseau', () => {
    expect(distanceKm(A, A)).toBe(0);
    expect(distanceKm(A, B)).toBeGreaterThan(3.3);
    expect(distanceKm(A, B)).toBeLessThan(3.7);
  });

  it('range les étapes de proche en proche en partant de la première', () => {
    // A (centre) → C (loin au sud) → B serait plus long que A → B → C.
    const t = estimerTournee([A, C, B]);
    expect(t.source).toBe('estimation');
    expect(t.ordre).toEqual([0, 2, 1]);
    expect(t.etapes).toHaveLength(2);
    expect(t.etapes[0]?.distanceM).toBeGreaterThan(0);
    expect(t.trace).toHaveLength(3);
    expect(t.distanceM).toBe(t.etapes.reduce((s, e) => s + e.distanceM, 0));
  });

  it('gère une seule étape', () => {
    const t = estimerTournee([A]);
    expect(t).toMatchObject({ ordre: [0], etapes: [], distanceM: 0, dureeS: 0 });
  });
});

describe('routeur OSRM', () => {
  it('demande le meilleur ordre en gardant la première étape comme départ', async () => {
    const fetchFn = vi.fn<(url: string) => Promise<Response>>(() =>
      reponse({
        code: 'Ok',
        // L'étape 1 d'entrée passe en dernier, l'étape 2 en deuxième.
        waypoints: [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }],
        trips: [
          {
            distance: 16000,
            duration: 1900,
            legs: [
              { distance: 11000, duration: 1100 },
              { distance: 5000, duration: 800 },
            ],
            geometry: {
              coordinates: [
                [4.8357, 45.764],
                [4.887, 45.6976],
                [4.8803, 45.7667],
              ],
            },
          },
        ],
      }),
    );
    const routeur = creerRouteur({ fetchFn, attendre: () => Promise.resolve() });
    const t = await routeur.tournee([A, B, C]);
    expect(t).toMatchObject({
      source: 'routes',
      ordre: [0, 2, 1],
      distanceM: 16000,
      dureeS: 1900,
      etapes: [
        { distanceM: 11000, dureeS: 1100 },
        { distanceM: 5000, dureeS: 800 },
      ],
    });
    expect(t.trace[0]).toEqual([45.764, 4.8357]);
    const url = new URL(fetchFn.mock.calls[0]?.[0] ?? '');
    expect(url.pathname).toBe('/trip/v1/driving/4.8357,45.764;4.8803,45.7667;4.887,45.6976');
    expect(url.searchParams.get('source')).toBe('first');
    expect(url.searchParams.get('roundtrip')).toBe('false');
    expect(url.searchParams.get('geometries')).toBe('geojson');
  });

  it('retombe sur l’estimation quand le service échoue ou répond mal', async () => {
    for (const fetchFn of [
      () => reponse({}, 503),
      () => reponse({ code: 'NoTrips' }),
      () => reponse({ code: 'Ok', trips: [] }),
      () => Promise.reject(new Error('réseau')),
    ]) {
      const routeur = creerRouteur({ fetchFn, attendre: () => Promise.resolve() });
      const t = await routeur.tournee([A, B, C]);
      expect(t.source).toBe('estimation');
      expect(t.ordre).toHaveLength(3);
    }
  });

  it('refuse moins de deux points ou trop de points', async () => {
    const routeur = creerRouteur({ fetchFn: () => reponse({}), attendre: () => Promise.resolve() });
    await expect(routeur.tournee([A])).rejects.toThrow(/deux étapes/);
    await expect(routeur.tournee(Array.from({ length: 26 }, () => A))).rejects.toThrow(/25/);
  });
});

describe('géocodeur d’adresses', () => {
  it('trouve les coordonnées d’une adresse française', async () => {
    const fetchFn = vi.fn<(url: string) => Promise<Response>>(() =>
      reponse({
        features: [
          {
            properties: { label: 'Place Bellecour 69002 Lyon' },
            geometry: { coordinates: [4.8317, 45.7576] },
          },
        ],
      }),
    );
    const g = creerGeocodeur({ fetchFn });
    expect(await g.adresse('place Bellecour Lyon')).toEqual({
      latitude: 45.7576,
      longitude: 4.8317,
      libelle: 'Place Bellecour 69002 Lyon',
    });
    const url = new URL(fetchFn.mock.calls[0]?.[0] ?? '');
    expect(url.origin).toBe('https://api-adresse.data.gouv.fr');
    expect(url.searchParams.get('q')).toBe('place Bellecour Lyon');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('rend null quand l’adresse est inconnue, introuvable ou le service en panne', async () => {
    expect(
      await creerGeocodeur({ fetchFn: () => reponse({ features: [] }) }).adresse('xyz'),
    ).toBeNull();
    expect(await creerGeocodeur({ fetchFn: () => reponse({}, 500) }).adresse('xyz')).toBeNull();
    expect(
      await creerGeocodeur({ fetchFn: () => Promise.reject(new Error('x')) }).adresse('xyz'),
    ).toBeNull();
    expect(await creerGeocodeur({ fetchFn: () => reponse({}) }).adresse('   ')).toBeNull();
  });
});
