// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResumeListeBase } from '../api.js';
import { EntreprisesBase } from './EntreprisesBase.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ligne = (id: string, nom: string, extra = {}) => ({
  id,
  siren: id === 'e1' ? '123456789' : '222222222',
  nom,
  ville: 'CHASSIEU',
  departement: '69',
  naf: '25.62B',
  effectif: '20 à 49 salariés',
  categorie: 'PME',
  ca: 425000,
  nbContacts: 2,
  listes: [],
  ...extra,
});
const listes: ResumeListeBase[] = [
  { id: 'l1', nom: 'Cibles Rhône', type: 'entreprises', mandat: null, nombre: 1 },
  { id: 'l2', nom: 'À appeler', type: 'contacts', mandat: null, nombre: 4 },
];

type Appel = { url: string; method: string; body?: unknown };
function simuler(entreprises: unknown[], total = entreprises.length) {
  const appels: Appel[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      appels.push({
        url,
        method,
        body: init?.body ? (JSON.parse(init.body) as unknown) : undefined,
      });
      const corps = method === 'GET' ? { entreprises, total } : { ajoutees: 1, id: 'l3', ok: true };
      return Promise.resolve(new Response(JSON.stringify(corps)));
    }),
  );
  return appels;
}

describe('Entreprises de la base', () => {
  it('liste les entreprises avec leurs contacts et leurs listes', async () => {
    simuler([
      ligne('e1', 'ATELIER FICTIF', { listes: ['l1'] }),
      ligne('e2', 'BUREAU FICTIF', { ca: null }),
    ]);
    render(
      <EntreprisesBase slug="base" listes={listes} onChange={vi.fn()} onVoirContacts={vi.fn()} />,
    );
    expect(await screen.findByText('ATELIER FICTIF')).toBeTruthy();
    expect(screen.getByText('SIREN 123456789')).toBeTruthy();
    expect(screen.getByText('Cibles Rhône')).toBeTruthy();
    expect(screen.getByText(/425\s?000/)).toBeTruthy();
    expect(screen.getByText('2 entreprises')).toBeTruthy();
  });

  it('cherche, et ne propose que les listes d’entreprises', async () => {
    const appels = simuler([ligne('e1', 'ATELIER FICTIF')]);
    render(
      <EntreprisesBase slug="base" listes={listes} onChange={vi.fn()} onVoirContacts={vi.fn()} />,
    );
    await screen.findByText('ATELIER FICTIF');
    fireEvent.change(screen.getByLabelText('Rechercher une entreprise de la base'), {
      target: { value: 'atelier' },
    });
    await waitFor(() => expect(appels.at(-1)?.url).toContain('q=atelier'));
    const options = screen
      .getByLabelText('Filtrer les entreprises par liste')
      .querySelectorAll('option');
    expect([...options].map((o) => o.textContent)).toEqual([
      'Toutes les entreprises',
      'Cibles Rhône (1)',
    ]);
  });

  it('range la sélection dans une liste d’entreprises existante', async () => {
    const appels = simuler([ligne('e1', 'ATELIER FICTIF'), ligne('e2', 'BUREAU FICTIF')]);
    const onChange = vi.fn();
    render(
      <EntreprisesBase slug="base" listes={listes} onChange={onChange} onVoirContacts={vi.fn()} />,
    );
    fireEvent.click(await screen.findByLabelText('Sélectionner ATELIER FICTIF'));
    fireEvent.change(screen.getByLabelText('Ajouter les entreprises à une liste'), {
      target: { value: 'l1' },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const post = appels.find((a) => a.method === 'POST');
    expect(post).toMatchObject({
      url: '/api/i/base/base/listes/l1/entreprises',
      body: { ids: ['e1'] },
    });
    expect(await screen.findByText('1 entreprise ajoutée à la liste.')).toBeTruthy();
  });

  it('crée une liste d’entreprises à la volée', async () => {
    const appels = simuler([ligne('e1', 'ATELIER FICTIF')]);
    vi.spyOn(window, 'prompt').mockReturnValue('Nouvelle cible');
    render(<EntreprisesBase slug="base" listes={[]} onChange={vi.fn()} onVoirContacts={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText('Sélectionner ATELIER FICTIF'));
    fireEvent.change(screen.getByLabelText('Ajouter les entreprises à une liste'), {
      target: { value: 'nouvelle' },
    });
    await waitFor(() =>
      expect(appels.some((a) => a.url.endsWith('/listes/l3/entreprises'))).toBe(true),
    );
    expect(appels.find((a) => a.url.endsWith('/base/listes'))?.body).toMatchObject({
      nom: 'Nouvelle cible',
      type: 'entreprises',
    });
  });

  it('retire de la liste affichée et ouvre les contacts de la liste', async () => {
    const appels = simuler([ligne('e1', 'ATELIER FICTIF', { listes: ['l1'] })]);
    const onVoirContacts = vi.fn();
    render(
      <EntreprisesBase
        slug="base"
        listes={listes}
        onChange={vi.fn()}
        onVoirContacts={onVoirContacts}
      />,
    );
    await screen.findByText('ATELIER FICTIF');
    fireEvent.change(screen.getByLabelText('Filtrer les entreprises par liste'), {
      target: { value: 'l1' },
    });
    await waitFor(() => expect(appels.at(-1)?.url).toContain('liste=l1'));
    fireEvent.click(screen.getByRole('button', { name: 'Voir les contacts de cette liste' }));
    expect(onVoirContacts).toHaveBeenCalledWith('l1');
    fireEvent.click(await screen.findByLabelText('Sélectionner ATELIER FICTIF'));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer de cette liste' }));
    await waitFor(() => expect(appels.some((a) => a.method === 'DELETE')).toBe(true));
    expect(appels.find((a) => a.method === 'DELETE')).toMatchObject({
      url: '/api/i/base/base/listes/l1/entreprises',
      body: { ids: ['e1'] },
    });
  });

  it('explique comment remplir la vue quand elle est vide', async () => {
    simuler([]);
    render(<EntreprisesBase slug="base" listes={[]} onChange={vi.fn()} onVoirContacts={vi.fn()} />);
    expect(await screen.findByText(/Chercher des entreprises/)).toBeTruthy();
  });
});
