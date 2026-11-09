// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntrepriseFiche } from './EntrepriseFiche.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const entreprise = {
  id: 'e1',
  siren: '123456789',
  nom: 'ATELIER FICTIF',
  naf: '25.62B',
  categorie: 'PME',
  effectif: '20 à 49 salariés',
  adresse: '30 RUE DES TESTS 69680 CHASSIEU',
  ville: 'CHASSIEU',
  active: true,
  formeJuridique: '5710',
  creeLe: '1996-03-01',
  oppositionDiffusion: true,
  etablissementsOuverts: 2,
  siteWeb: null,
  siteTelephones: [],
  siteEmails: [],
  linkedin: null,
  siteConfirme: false,
  siteLuLe: null,
  finances: [{ annee: 2022, ca: 425165, resultat: -9666 }],
  dirigeants: [{ nom: 'Jeanne DUPONT', fonction: 'Président', societe: false }],
};

type Appel = { url: string; method: string; body?: unknown };

function simuler(reponses: Record<string, unknown>) {
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
      const cle = Object.keys(reponses).find((c) => `${method} ${url}`.endsWith(c));
      return Promise.resolve(
        new Response(JSON.stringify(cle ? reponses[cle] : {}), { status: cle ? 200 : 404 }),
      );
    }),
  );
  return appels;
}

describe('Fiche entreprise de la base', () => {
  it('propose les entreprises de l’annuaire et rattache celle que l’on choisit', async () => {
    const appels = simuler({
      'GET /api/i/base/base/fiches/f1/entreprise/candidats': { candidats: [entreprise] },
      'POST /api/i/base/base/fiches/f1/entreprise': { entreprise, rattachees: 3 },
    });
    const onChange = vi.fn();
    render(<EntrepriseFiche slug="base" ficheId="f1" entrepriseId={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Rattacher à l’annuaire/ }));
    expect(await screen.findByText(/ATELIER FICTIF/)).toBeTruthy();
    expect(screen.getByText(/CHASSIEU/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Choisir/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(
      appels.find((a) => a.method === 'POST' && a.url.endsWith('/fiches/f1/entreprise')),
    ).toMatchObject({ body: { siren: '123456789' } });
    expect(await screen.findByText(/3 contacts rattachés/)).toBeTruthy();
  });

  it('accepte un SIREN saisi à la main', async () => {
    const appels = simuler({
      'GET /api/i/base/base/fiches/f1/entreprise/candidats': { candidats: [] },
      'POST /api/i/base/base/fiches/f1/entreprise': { entreprise, rattachees: 1 },
    });
    render(<EntrepriseFiche slug="base" ficheId="f1" entrepriseId={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Rattacher à l’annuaire/ }));
    expect(await screen.findByText(/Aucune entreprise proposée/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('SIREN'), { target: { value: '123 456 789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rattacher ce SIREN' }));
    await waitFor(() => expect(appels.at(-1)?.body).toEqual({ siren: '123 456 789' }));
  });

  it('affiche la fiche entreprise rattachée avec ses repères et son alerte', async () => {
    simuler({ 'GET /api/i/base/base/entreprises/e1': entreprise });
    render(<EntrepriseFiche slug="base" ficheId="f1" entrepriseId="e1" onChange={vi.fn()} />);
    expect(await screen.findByText('ATELIER FICTIF')).toBeTruthy();
    expect(screen.getByText(/123 456 789/)).toBeTruthy();
    expect(screen.getByText(/20 à 49 salariés/)).toBeTruthy();
    expect(screen.getByText(/Jeanne DUPONT/)).toBeTruthy();
    expect(screen.getByText(/2022/)).toBeTruthy();
    expect(screen.getByText(/s’oppose à la diffusion/)).toBeTruthy();
  });

  it('détache la fiche de son entreprise', async () => {
    const appels = simuler({
      'GET /api/i/base/base/entreprises/e1': entreprise,
      'DELETE /api/i/base/base/fiches/f1/entreprise': { ok: true },
    });
    const onChange = vi.fn();
    render(<EntrepriseFiche slug="base" ficheId="f1" entrepriseId="e1" onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: /Détacher/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(appels.at(-1)).toMatchObject({ method: 'DELETE' });
  });

  it('dit quand l’annuaire ne répond pas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Annuaire indisponible.' }), { status: 502 }),
        ),
      ),
    );
    render(<EntrepriseFiche slug="base" ficheId="f1" entrepriseId={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Rattacher à l’annuaire/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
