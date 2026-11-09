// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlerteSignaux } from './AlerteSignaux.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Appel = { url: string; method: string; body?: unknown };
function simuler(initial: unknown, apres?: unknown) {
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
      const corps = method === 'GET' ? initial : (apres ?? initial);
      return Promise.resolve(new Response(JSON.stringify(corps)));
    }),
  );
  return appels;
}

describe('Alerte quotidienne du BODACC', () => {
  it('propose d’activer la veille et enregistre l’heure choisie', async () => {
    const appels = simuler({ active: false, heure: '08:00' }, { active: true, heure: '07:15' });
    render(<AlerteSignaux slug="base" />);
    expect(await screen.findByText('Veille éteinte')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Heure/), { target: { value: '07:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activer la veille quotidienne' }));
    expect(await screen.findByText('Veille active')).toBeTruthy();
    expect(appels.at(-1)).toMatchObject({
      url: '/api/i/base/base/signaux/routine',
      method: 'PUT',
      body: { active: true, heure: '07:15' },
    });
    expect(screen.getByText(/chaque jour à partir de 07:15/)).toBeTruthy();
  });

  it('montre le dernier passage et permet d’éteindre la veille', async () => {
    const appels = simuler(
      {
        active: true,
        heure: '08:00',
        dernierJour: '2026-11-09',
        bilan: '12 entreprises vérifiées, 1 sujet dans l’Inbox.',
      },
      { active: false, heure: '08:00' },
    );
    render(<AlerteSignaux slug="base" />);
    expect(await screen.findByText(/12 entreprises vérifiées/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Éteindre la veille' }));
    expect(await screen.findByText('Veille éteinte')).toBeTruthy();
    expect(appels.at(-1)?.body).toEqual({ active: false, heure: '08:00' });
  });

  it('vérifie tout de suite et affiche le bilan', async () => {
    const appels = simuler(
      { active: false, heure: '08:00' },
      {
        verifiees: 3,
        nouveaux: 2,
        deposes: 1,
        echecs: 0,
        bilan: '3 entreprises vérifiées, 1 sujet dans l’Inbox.',
      },
    );
    render(<AlerteSignaux slug="base" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vérifier maintenant' }));
    expect(await screen.findByText('3 entreprises vérifiées, 1 sujet dans l’Inbox.')).toBeTruthy();
    expect(appels.at(-1)).toMatchObject({
      url: '/api/i/base/base/signaux/routine/lancer',
      method: 'POST',
    });
  });

  it('affiche l’erreur du serveur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: { method?: string }) =>
        Promise.resolve(
          init?.method === 'PUT'
            ? new Response(JSON.stringify({ error: 'Demande invalide' }), { status: 400 })
            : new Response(JSON.stringify({ active: false, heure: '08:00' })),
        ),
      ),
    );
    render(<AlerteSignaux slug="base" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activer la veille quotidienne' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('invalide'));
  });
});
