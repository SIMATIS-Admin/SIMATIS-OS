// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchCompteurInbox: vi.fn(), fetchPipeline: vi.fn() }));
vi.mock('../api.js', () => api);
vi.mock('./Inbox.js', () => ({ Inbox: ({ slug }: { slug: string }) => <p>Inbox de {slug}</p> }));
vi.mock('../visio/Enregistrements.js', () => ({
  Enregistrements: ({ slug }: { slug: string }) => <p>Enregistrements de {slug}</p>,
}));
vi.mock('./AideRelance.js', () => ({
  AideRelance: ({ slug }: { slug: string }) => <p>Aide à la relance de {slug}</p>,
}));
vi.mock('./Brief.js', () => ({
  Brief: ({ slug, children }: { slug: string; children?: ReactNode }) => (
    <>
      <p>Brief de {slug}</p>
      {children}
    </>
  ),
}));

import { Cockpit } from './Cockpit.js';

describe('Cockpit', () => {
  beforeEach(() => {
    api.fetchPipeline.mockResolvedValue({
      etapes: [
        { id: 'detection', label: 'Détection' },
        { id: 'prospection', label: 'Prospection' },
        { id: 'qualification', label: 'Qualification' },
      ],
      inactiviteJours: 14,
      opportunites: [],
    });
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("montre le brief du jour et replie l'Inbox en un bandeau, sans l'afficher", async () => {
    api.fetchCompteurInbox.mockResolvedValue(3);
    render(<Cockpit slug="simatis" />);
    expect(screen.getByRole('region', { name: 'Brief du jour' }).textContent).toContain(
      'Brief de simatis',
    );
    expect(await screen.findByText('3 à traiter')).toBeTruthy();
    expect(screen.queryByText('Inbox de simatis')).toBeNull();
  });

  it('montre les enregistrements de visio dans le cockpit', () => {
    api.fetchCompteurInbox.mockResolvedValue(0);
    render(<Cockpit slug="simatis" />);
    expect(screen.getByText('Enregistrements de simatis')).toBeTruthy();
  });

  it("ouvre l'Inbox dans une fenêtre, et la referme en prévenant l'écran", async () => {
    api.fetchCompteurInbox.mockResolvedValue(3);
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
    api.fetchCompteurInbox.mockResolvedValue(0);
    render(<Cockpit slug="simatis" />);
    const bandeau = await screen.findByRole('region', { name: 'Inbox' });
    await waitFor(() => expect(bandeau.textContent).toContain('Rien à traiter'));
    expect(bandeau.classList.contains('vide')).toBe(true);
  });

  it("ouvre l'Inbox quand l'en-tête demande un ajout ou le pas à pas", async () => {
    api.fetchCompteurInbox.mockResolvedValue(0);
    const { rerender } = render(<Cockpit slug="simatis" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<Cockpit slug="simatis" ajoutOuvert />);
    expect(await screen.findByRole('dialog', { name: 'Inbox' })).toBeTruthy();
    cleanup();
    api.fetchCompteurInbox.mockResolvedValue(0);
    render(<Cockpit slug="simatis" pasAPas />);
    expect(await screen.findByRole('dialog', { name: 'Inbox' })).toBeTruthy();
  });

  it('reste utilisable quand le compteur est indisponible', async () => {
    api.fetchCompteurInbox.mockRejectedValue(new Error('hors ligne'));
    render(<Cockpit slug="simatis" />);
    expect(await screen.findByRole('button', { name: 'Ouvrir' })).toBeTruthy();
  });

  it("affiche l'état du Radar et du Pipeline avec les alertes utiles", async () => {
    api.fetchCompteurInbox.mockResolvedValue(0);
    api.fetchPipeline.mockResolvedValue({
      etapes: [
        { id: 'detection', label: 'Détection' },
        { id: 'prospection', label: 'Prospection' },
        { id: 'qualification', label: 'Qualification' },
      ],
      inactiviteJours: 14,
      opportunites: [
        {
          id: 'r1',
          etape: 'detection',
          clos: null,
          tentatives: 3,
          radar: 'sans_reponse',
          radarEtapeManuelle: null,
        },
        {
          id: 'r2',
          etape: 'prospection',
          clos: null,
          tentatives: 1,
          radar: 'repondu',
          radarEtapeManuelle: null,
        },
        {
          id: 'p1',
          etape: 'qualification',
          clos: null,
          joursInactif: 18,
          prochaine: { echeance: '2026-11-19', enRetard: true },
        },
      ],
    });
    render(<Cockpit slug="simatis" />);
    const etat = await screen.findByRole('region', { name: 'État du Radar et du Pipeline' });
    const radar = etat.querySelector<HTMLAnchorElement>('a[href="#/simatis/radar"]')!;
    const pipeline = etat.querySelector<HTMLAnchorElement>('a[href="#/simatis/pipeline"]')!;
    expect(radar.textContent).toMatch(/Radaraffaires actives2à relancer1a répondu1/);
    expect(pipeline.textContent).toMatch(/Pipelineaffaire ouverte1inactive1action en retard1/);
  });

  it("met la date du jour tout en haut, avant l'Inbox", async () => {
    api.fetchCompteurInbox.mockResolvedValue(0);
    render(<Cockpit slug="simatis" />);
    const date = new Date().toLocaleDateString('fr-FR', {
      timeZone: 'Europe/Paris',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    const titre = screen.getByRole('heading', { name: date });
    const inbox = await screen.findByText('Rien à traiter');
    expect(titre.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Aide à la relance de simatis')).toBeTruthy();
  });
});
