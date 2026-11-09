// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PointCarteWeb } from '../api.js';
import { CarteEntreprises, lienItineraire } from './CarteEntreprises.js';

// Leaflet needs a real browser: the map is replaced by one button per company.
vi.mock('./CarteLeaflet.js', () => ({
  default: ({
    points,
    ordre,
    trace,
    onBasculer,
  }: {
    points: PointCarteWeb[];
    ordre: string[];
    trace: unknown[] | null;
    onBasculer: (id: string) => void;
  }) => (
    <div data-testid="carte" data-trace={trace ? trace.length : 'aucune'}>
      {points.map((p) => (
        <button key={p.id} onClick={() => onBasculer(p.id)}>
          {`${p.nom}${ordre.includes(p.id) ? ` n°${ordre.indexOf(p.id) + 1}` : ''}`}
        </button>
      ))}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const point = (id: string, nom: string, latitude: number): PointCarteWeb => ({
  id,
  siren: id,
  nom,
  ville: 'LYON',
  latitude,
  longitude: 4.85,
  nbContacts: 1,
});
const POINTS = [
  point('a', 'ATELIER', 45.76),
  point('b', 'BUREAU', 45.77),
  point('c', 'CHANTIER', 45.7),
];

type Appel = { url: string; body: unknown };
function simuler(tournee?: unknown, statutTournee = 200) {
  const appels: Appel[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { body?: string }) => {
      appels.push({ url, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
      if (url.includes('/entreprises/carte'))
        return Promise.resolve(
          new Response(JSON.stringify({ points: POINTS, sansCoordonnees: 2, total: 5 })),
        );
      return Promise.resolve(
        new Response(JSON.stringify(tournee ?? {}), { status: statutTournee }),
      );
    }),
  );
  return appels;
}

const TOURNEE = {
  etapes: [
    {
      id: 'a',
      nom: 'ATELIER',
      ville: 'LYON',
      adresse: null,
      latitude: 45.76,
      longitude: 4.85,
      distanceM: 0,
      dureeS: 0,
    },
    {
      id: 'c',
      nom: 'CHANTIER',
      ville: 'LYON',
      adresse: null,
      latitude: 45.7,
      longitude: 4.85,
      distanceM: 11300,
      dureeS: 1130,
    },
    {
      id: 'b',
      nom: 'BUREAU',
      ville: 'LYON',
      adresse: null,
      latitude: 45.77,
      longitude: 4.85,
      distanceM: 5000,
      dureeS: 800,
    },
  ],
  distanceM: 16300,
  dureeS: 1930,
  trace: [
    [45.76, 4.85],
    [45.7, 4.85],
  ] as [number, number][],
  source: 'routes' as const,
  ignorees: [],
};

describe('Carte des entreprises', () => {
  it('affiche les entreprises localisées et compte celles qui ne le sont pas', async () => {
    simuler();
    render(<CarteEntreprises slug="base" filtres={{}} />);
    expect(
      await screen.findByText(/3 entreprises sur la carte, 2 sans adresse localisable/),
    ).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'ATELIER' })).toBeTruthy();
    expect(screen.getByText('Aucune entreprise choisie.')).toBeTruthy();
  });

  it('suit le filtre de la liste', async () => {
    const appels = simuler();
    render(<CarteEntreprises slug="base" filtres={{ q: 'atelier', liste: 'l1' }} />);
    await screen.findByText(/sur la carte/);
    expect(appels[0]?.url).toContain('q=atelier');
    expect(appels[0]?.url).toContain('liste=l1');
  });

  it('numérote les entreprises choisies, dans l’ordre du clic, et permet de les retirer', async () => {
    simuler();
    render(<CarteEntreprises slug="base" filtres={{}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'BUREAU' }));
    fireEvent.click(screen.getByRole('button', { name: 'ATELIER' }));
    expect(screen.getByRole('button', { name: 'BUREAU n°1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ATELIER n°2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer BUREAU de la tournée' }));
    expect(screen.getByRole('button', { name: 'ATELIER n°1' })).toBeTruthy();
  });

  it('calcule la tournée, la montre dans l’ordre et propose Google Maps', async () => {
    const appels = simuler(TOURNEE);
    render(<CarteEntreprises slug="base" filtres={{}} />);
    for (const nom of ['ATELIER', 'BUREAU', 'CHANTIER'])
      fireEvent.click(await screen.findByRole('button', { name: nom }));
    fireEvent.click(screen.getByRole('button', { name: 'Calculer la tournée' }));
    const resultat = await screen.findByLabelText('Résultat de la tournée');
    expect(resultat.textContent).toContain('16,3 km');
    expect(resultat.textContent).toContain('32 min');
    expect(resultat.textContent).toContain('itinéraire routier');
    expect(resultat.textContent).toMatch(/ATELIER.*CHANTIER.*11,3 km, 19 min.*BUREAU/s);
    expect(appels.at(-1)).toMatchObject({
      url: '/api/i/base/base/tournee',
      body: { ids: ['a', 'b', 'c'] },
    });
    // La carte reprend l'ordre calculé : le chantier passe avant le bureau.
    await waitFor(() => expect(screen.getByRole('button', { name: 'CHANTIER n°2' })).toBeTruthy());
    expect(screen.getByTestId('carte').getAttribute('data-trace')).toBe('2');
    const lien = screen.getByRole('link', { name: /Google Maps/ });
    expect(lien.getAttribute('href')).toBe(
      'https://www.google.com/maps/dir/45.76,4.85/45.7,4.85/45.77,4.85',
    );
  });

  it('envoie l’adresse de départ et dit quand le calcul est une estimation', async () => {
    const appels = simuler({ ...TOURNEE, source: 'estimation', ignorees: ['SANS GPS'] });
    render(<CarteEntreprises slug="base" filtres={{}} initiales={['a']} />);
    fireEvent.change(await screen.findByLabelText(/Adresse de départ/), {
      target: { value: '5 rue du Départ Lyon' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Calculer la tournée' }));
    const resultat = await screen.findByLabelText('Résultat de la tournée');
    expect(resultat.textContent).toContain('estimation à vol d’oiseau');
    expect(resultat.textContent).toContain('SANS GPS');
    expect(appels.at(-1)?.body).toEqual({ ids: ['a'], depart: '5 rue du Départ Lyon' });
  });

  it('demande au moins deux étapes et affiche l’erreur du serveur', async () => {
    simuler({ error: 'Il faut au moins deux entreprises localisées.' }, 400);
    render(<CarteEntreprises slug="base" filtres={{}} initiales={['a']} />);
    const bouton = await screen.findByRole('button', { name: 'Calculer la tournée' });
    expect((bouton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'BUREAU' }));
    fireEvent.click(bouton);
    expect((await screen.findByRole('alert')).textContent).toContain('au moins deux');
  });

  it('limite le lien Google Maps aux dix premières étapes', () => {
    const etapes = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      nom: `E${i}`,
      ville: null,
      adresse: null,
      latitude: 45 + i,
      longitude: 4,
      distanceM: 0,
      dureeS: 0,
    }));
    const lien = lienItineraire({ ...TOURNEE, etapes });
    expect(lien.split('/dir/')[1]?.split('/')).toHaveLength(10);
  });
});
