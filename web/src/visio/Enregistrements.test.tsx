// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Enregistrements } from './Enregistrements.js';

let liste: object[];
let appels: { url: string; method: string }[];
const ligne = (extra: object) => ({
  id: 's1',
  rdvId: 'os:v1',
  titre: 'V - Atelier Fictif x Simatis',
  debutAt: '2026-10-12T08:00:00.000Z',
  finAt: '2026-10-12T08:30:00.000Z',
  statut: 'transcrit',
  aResume: false,
  ...extra,
});

describe('Enregistrements du cockpit', () => {
  beforeEach(() => {
    liste = [];
    appels = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: { method?: string }) => {
        appels.push({ url, method: init?.method ?? 'GET' });
        if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
        return Promise.resolve(new Response(JSON.stringify(liste)));
      }),
    );
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('n’occupe qu’une barre discrète tant que la fenêtre est fermée', async () => {
    liste = [ligne({})];
    render(<Enregistrements slug="simatis" />);
    expect(await screen.findByRole('button', { name: 'Ouvrir' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ouvre une fenêtre avec le bouton Enregistrer et la liste', async () => {
    liste = [
      ligne({ id: 'a', statut: 'en_cours', finAt: null }),
      ligne({ id: 'b', titre: 'Enregistrement du 12/10/2026 à 10h00', aResume: true }),
    ];
    const lancer = vi.fn();
    render(<Enregistrements slug="simatis" onEnregistrer={lancer} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir' }));
    const fenetre = await screen.findByRole('dialog', { name: 'Enregistrements' });
    expect(await within(fenetre).findByText('En cours')).toBeTruthy();
    expect(within(fenetre).getByText('Résumé prêt')).toBeTruthy();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' }));
    expect(lancer).toHaveBeenCalledOnce();
  });

  it('dit quand il n’y a encore aucun enregistrement', async () => {
    render(<Enregistrements slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir' }));
    expect(await screen.findByText(/Aucun enregistrement pour l’instant/)).toBeTruthy();
  });

  it('supprime un enregistrement depuis la liste après confirmation', async () => {
    liste = [ligne({ id: 'x1' })];
    render(<Enregistrements slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir' }));
    const fenetre = await screen.findByRole('dialog');
    fireEvent.click(await within(fenetre).findByRole('button', { name: 'Supprimer' }));
    await waitFor(() =>
      expect(
        appels.some((c) => c.method === 'DELETE' && c.url.endsWith('/visio/sessions/x1')),
      ).toBe(true),
    );
  });

  it('propose le lien vers la fiche du rendez-vous', async () => {
    liste = [ligne({})];
    render(<Enregistrements slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir' }));
    const lien = await screen.findByRole('link', { name: 'Ouvrir la fiche' });
    expect(lien.getAttribute('href')).toBe('#/simatis/fiche/rdv/os%3Av1');
  });

  it('suggère la réunion probable et fusionne d’un clic, après confirmation', async () => {
    liste = [
      ligne({
        id: 'libre1',
        titre: 'Enregistrement du 12/10/2026 à 10h00',
        suggestion: { rdvId: 'g-9', titre: 'V - Réunion Fictive', debut: '2026-10-12T08:00:00Z' },
      }),
    ];
    render(<Enregistrements slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir' }));
    const fenetre = await screen.findByRole('dialog');
    expect(await within(fenetre).findByText('V - Réunion Fictive')).toBeTruthy();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Fusionner' }));
    await waitFor(() =>
      expect(
        appels.some((c) => c.method === 'POST' && c.url.endsWith('/visio/sessions/libre1/fusion')),
      ).toBe(true),
    );
  });

  it('ne propose pas de fusion sans suggestion', async () => {
    liste = [ligne({})];
    render(<Enregistrements slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir' }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Fusionner' })).toBeNull();
  });
});
