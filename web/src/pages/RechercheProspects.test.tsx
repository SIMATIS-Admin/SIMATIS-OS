// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RechercheProspects } from './RechercheProspects.js';
import { SuiviRecherche } from './SuiviRecherche.js';
import type { RechercheEnCours } from '../api.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('permet de fermer pendant la recherche, puis de retrouver les résultats depuis une autre rubrique', async () => {
  let tache: RechercheEnCours | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/routine'))
        return Promise.resolve(Response.json({ consignes: 'Critères fictifs' }));
      if (init?.method === 'POST')
        tache = { id: 'fictif', etat: 'en_cours', nombre: 10, debut: '2026-01-01T09:00:00Z' };
      return Promise.resolve(Response.json(tache));
    }),
  );
  const fermer = vi.fn();
  const vue = render(<RechercheProspects slug="fictif" fermer={fermer} termine={vi.fn()} />);
  const lancer = await screen.findByRole('button', { name: 'Lancer maintenant' });
  await waitFor(() => expect(lancer.hasAttribute('disabled')).toBe(false));
  fireEvent.click(lancer);
  fireEvent.click(await screen.findByRole('button', { name: 'Mettre en arrière-plan' }));
  expect(fermer).toHaveBeenCalledOnce();
  vue.unmount();
  tache = { ...tache!, etat: 'terminee', contacts: [] };
  render(<SuiviRecherche slug="fictif" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Voir les résultats' }));
  expect(await screen.findByText('0 contact(s) retenu(s) sur 10 visés.')).toBeTruthy();
});
