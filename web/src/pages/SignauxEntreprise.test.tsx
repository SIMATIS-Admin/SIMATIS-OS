// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignauxEntreprise } from './SignauxEntreprise.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const alerte = {
  id: 's1',
  date: '2026-10-05',
  famille: 'Procédure collective',
  nature: 'Jugement d’ouverture de redressement judiciaire',
  gravite: 'alerte',
  detail: null,
  url: 'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A1',
};
const info = {
  id: 's2',
  date: '2026-09-01',
  famille: 'Modification',
  nature: 'Changement de gérant.',
  gravite: 'info',
  detail: null,
  url: null,
};

type Appel = { url: string; method: string };
function simuler(lecture: unknown, apresActualisation?: unknown, statut = 200) {
  const appels: Appel[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      appels.push({ url, method });
      const corps = method === 'POST' ? (apresActualisation ?? lecture) : lecture;
      return Promise.resolve(
        new Response(JSON.stringify(corps), { status: method === 'POST' ? statut : 200 }),
      );
    }),
  );
  return appels;
}

const recent = () => new Date(Date.now() - 864e5).toISOString();

describe('Signaux du BODACC d’une entreprise', () => {
  it('montre les annonces, avertit d’une procédure et ne relit pas un contrôle récent', async () => {
    const appels = simuler({ signaux: [alerte, info], verifieLe: recent() });
    render(<SignauxEntreprise slug="base" entrepriseId="e1" />);
    expect(await screen.findByText(/Jugement d’ouverture de redressement judiciaire/)).toBeTruthy();
    expect(screen.getByText(/Changement de gérant/)).toBeTruthy();
    expect(screen.getByText(/vérifiez avant de contacter/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'annonce' }).getAttribute('href')).toContain(
      'bodacc.fr',
    );
    expect(appels.every((a) => a.method === 'GET')).toBe(true);
  });

  it('interroge le BODACC tout seul quand l’entreprise n’a jamais été vérifiée', async () => {
    const appels = simuler(
      { signaux: [], verifieLe: null },
      { signaux: [info], verifieLe: recent(), nouveaux: 1 },
    );
    render(<SignauxEntreprise slug="base" entrepriseId="e1" />);
    expect(await screen.findByText(/Changement de gérant/)).toBeTruthy();
    expect(appels.map((a) => a.method)).toEqual(['GET', 'POST']);
    expect(appels[1]?.url).toBe('/api/i/base/base/entreprises/e1/signaux/actualiser');
    expect(screen.queryByText(/vérifiez avant de contacter/)).toBeNull();
  });

  it('relit aussi un contrôle de plus d’une semaine', async () => {
    const vieux = new Date(Date.now() - 10 * 864e5).toISOString();
    const appels = simuler(
      { signaux: [], verifieLe: vieux },
      { signaux: [], verifieLe: recent(), nouveaux: 0 },
    );
    render(<SignauxEntreprise slug="base" entrepriseId="e1" />);
    await waitFor(() => expect(appels.map((a) => a.method)).toEqual(['GET', 'POST']));
  });

  it('dit qu’il n’y a rien de notable, et actualise à la demande', async () => {
    const appels = simuler({ signaux: [], verifieLe: recent() });
    render(<SignauxEntreprise slug="base" entrepriseId="e1" />);
    expect(await screen.findByText('Aucune annonce notable depuis 2 ans.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
    await waitFor(() => expect(appels.at(-1)?.method).toBe('POST'));
  });

  it('affiche l’erreur du BODACC sans bloquer la fiche', async () => {
    simuler({ signaux: [], verifieLe: null }, { error: 'BODACC indisponible.' }, 502);
    render(<SignauxEntreprise slug="base" entrepriseId="e1" />);
    expect(await screen.findByText('BODACC indisponible.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
