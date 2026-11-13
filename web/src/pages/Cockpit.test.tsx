// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const compteur = vi.hoisted(() => vi.fn());
vi.mock('../api.js', () => ({ fetchCompteurInbox: compteur }));
vi.mock('./Inbox.js', () => ({ Inbox: ({ slug }: { slug: string }) => <p>Inbox de {slug}</p> }));
vi.mock('./Brief.js', () => ({ Brief: ({ slug }: { slug: string }) => <p>Brief de {slug}</p> }));

import { Cockpit } from './Cockpit.js';

describe('Cockpit', () => {
  afterEach(() => {
    cleanup();
    compteur.mockReset();
  });

  it("montre le brief du jour et replie l'Inbox en un bandeau, sans l'afficher", async () => {
    compteur.mockResolvedValue(3);
    render(<Cockpit slug="simatis" />);
    expect(screen.getByRole('region', { name: 'Brief du jour' }).textContent).toBe(
      'Brief de simatis',
    );
    expect(await screen.findByText('Inbox : 3 à traiter')).toBeTruthy();
    expect(screen.queryByText('Inbox de simatis')).toBeNull();
  });

  it("ouvre l'Inbox dans une fenêtre, et la referme en prévenant l'écran", async () => {
    compteur.mockResolvedValue(3);
    const onFerme = vi.fn();
    render(<Cockpit slug="simatis" onFerme={onFerme} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir' }));
    const fenetre = screen.getByRole('dialog', { name: 'Inbox' });
    expect(fenetre.textContent).toContain('Inbox de simatis');
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onFerme).toHaveBeenCalledOnce();
  });

  it("n'occupe presque rien quand l'Inbox est vide", async () => {
    compteur.mockResolvedValue(0);
    render(<Cockpit slug="simatis" />);
    const bandeau = await screen.findByRole('region', { name: 'Inbox' });
    await waitFor(() => expect(bandeau.textContent).toContain('rien à traiter'));
    expect(bandeau.classList.contains('vide')).toBe(true);
  });

  it("ouvre l'Inbox quand l'en-tête demande un ajout ou le pas à pas", async () => {
    compteur.mockResolvedValue(0);
    const { rerender } = render(<Cockpit slug="simatis" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<Cockpit slug="simatis" ajoutOuvert />);
    expect(await screen.findByRole('dialog', { name: 'Inbox' })).toBeTruthy();
    cleanup();
    compteur.mockResolvedValue(0);
    render(<Cockpit slug="simatis" pasAPas />);
    expect(await screen.findByRole('dialog', { name: 'Inbox' })).toBeTruthy();
  });

  it('reste utilisable quand le compteur est indisponible', async () => {
    compteur.mockRejectedValue(new Error('hors ligne'));
    render(<Cockpit slug="simatis" />);
    expect(await screen.findByRole('button', { name: 'Ouvrir' })).toBeTruthy();
  });
});
