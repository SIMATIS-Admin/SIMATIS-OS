// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListesBase } from './ListesBase.js';
import { EtiquettesFiche } from './EtiquettesFiche.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Appel = { url: string; method: string; body?: unknown };

function simuler() {
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
      const corps = url.endsWith('/base/mandats')
        ? [{ slug: 'oid', nom: 'OID Fictif', debutMandat: null }]
        : { ok: true };
      return Promise.resolve(new Response(JSON.stringify(corps)));
    }),
  );
  return appels;
}

const listes = [
  { id: 'l1', nom: 'Industrie Ain', type: 'contacts' as const, mandat: null, nombre: 12 },
];

describe('Listes de la base', () => {
  it('crée une liste', async () => {
    const appels = simuler();
    const onChange = vi.fn();
    render(<ListesBase slug="base" listes={[]} onChange={onChange} />);
    expect(screen.getByText(/Aucune liste/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nouvelle liste'), { target: { value: ' À appeler ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la liste' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(appels.at(-1)).toMatchObject({
      url: '/api/i/base/base/listes',
      method: 'POST',
      body: { nom: 'À appeler', type: 'contacts' },
    });
  });

  it('assigne un mandat à la liste, la renomme et la supprime', async () => {
    const appels = simuler();
    const onChange = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ListesBase slug="base" listes={listes} onChange={onChange} />);
    expect(screen.getByText(/12 contacts/)).toBeTruthy();
    const mandat = await screen.findByLabelText('Mandat de la liste Industrie Ain');
    await screen.findByRole('option', { name: 'OID Fictif' });
    fireEvent.change(mandat, { target: { value: 'OID Fictif' } });
    await waitFor(() =>
      expect(appels.at(-1)).toMatchObject({
        url: '/api/i/base/base/listes/l1',
        method: 'PATCH',
        body: { mandat: 'OID Fictif' },
      }),
    );
    const nom = screen.getByLabelText('Nom de la liste Industrie Ain');
    fireEvent.change(nom, { target: { value: 'Ain' } });
    fireEvent.blur(nom);
    await waitFor(() => expect(appels.at(-1)?.body).toEqual({ nom: 'Ain' }));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la liste Industrie Ain' }));
    await waitFor(() => expect(appels.at(-1)).toMatchObject({ method: 'DELETE' }));
  });

  it('affiche l’erreur du serveur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Une liste porte déjà ce nom.' }), { status: 400 }),
        ),
      ),
    );
    render(<ListesBase slug="base" listes={[]} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nouvelle liste'), { target: { value: 'Doublon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la liste' }));
    expect((await screen.findByRole('alert')).textContent).toContain('porte déjà ce nom');
  });
});

describe('Étiquettes d’un contact', () => {
  it('ajoute et retire une étiquette', async () => {
    const appels = simuler();
    const onChange = vi.fn();
    render(
      <EtiquettesFiche
        slug="base"
        ficheId="f1"
        tags={['dirigeant']}
        suggestions={['dirigeant', 'salon 2026']}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Ajouter une étiquette'), {
      target: { value: 'Salon 2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(appels.at(-1)).toMatchObject({
      url: '/api/i/base/base/tags',
      method: 'POST',
      body: { ids: ['f1'], ajouter: ['Salon 2026'] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retirer l’étiquette dirigeant' }));
    await waitFor(() =>
      expect(appels.at(-1)?.body).toEqual({ ids: ['f1'], retirer: ['dirigeant'] }),
    );
  });
});
