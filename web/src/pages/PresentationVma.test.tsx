// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresentationVma } from './PresentationVma.js';

const api = vi.hoisted(() => ({ ouvrirEspaceTesteurVma: vi.fn() }));
vi.mock('../api.js', () => api);

const fenetre = { location: { href: '' }, close: vi.fn() };
beforeEach(() => {
  fenetre.location.href = '';
  fenetre.close.mockClear();
  api.ouvrirEspaceTesteurVma.mockReset();
  vi.spyOn(window, 'open').mockReturnValue(fenetre as unknown as Window);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const aller = (n: number) => fireEvent.click(screen.getByRole('button', { name: `Slide ${n}` }));

describe('Présentation du Test VMA', () => {
  it('s’ouvre sur le rythme commercial du moment, avec le logo VMA', () => {
    render(<PresentationVma slug="demo" />);
    expect(
      screen.getByRole('heading', {
        name: 'Votre performance commerciale du moment, en 10 minutes.',
      }),
    ).toBeTruthy();
    expect(screen.getByText(/rythme commercial du moment/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /pastille VMA/ })).toBeTruthy();
    expect(screen.getByText('1 / 6')).toBeTruthy();
  });

  it('montre un résultat fictif sans révéler la méthode de calcul', () => {
    render(<PresentationVma slug="demo" />);
    aller(5);
    expect(screen.getByRole('img', { name: 'Exemple de résultat du Test VMA' })).toBeTruthy();
    expect(screen.getByText(/entreprise fictive/)).toBeTruthy();
    const texte = document.body.textContent ?? '';
    expect(texte).not.toMatch(/potentiel brut|gain maximal|taux de transformation/i);
  });

  it('ouvre le module d’essai dans un nouvel onglet depuis la dernière slide', async () => {
    api.ouvrirEspaceTesteurVma.mockResolvedValue({
      lien: 'https://site.test/test-vma/testeur?t=abc',
      expireLe: '2030-01-01T00:00:00Z',
    });
    render(<PresentationVma slug="demo" />);
    aller(6);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le module d’essai' }));
    await waitFor(() =>
      expect(fenetre.location.href).toBe('https://site.test/test-vma/testeur?t=abc'),
    );
    expect(api.ouvrirEspaceTesteurVma).toHaveBeenCalledWith('demo');
  });

  it('referme l’onglet et affiche la raison quand le site refuse', async () => {
    api.ouvrirEspaceTesteurVma.mockRejectedValue(new Error('Test de VMA non configuré'));
    render(<PresentationVma slug="demo" />);
    aller(6);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le module d’essai' }));
    expect(await screen.findByText(/non configuré/)).toBeTruthy();
    expect(fenetre.close).toHaveBeenCalled();
  });
});
