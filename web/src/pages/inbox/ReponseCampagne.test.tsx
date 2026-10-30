// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReponseCampagneCarte } from './ReponseCampagne.js';

type Call = { url: string; method: string };
let calls: Call[] = [];
let reponse: unknown;
let refus: string | null;

function fakeFetch(url: string, init?: { method?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method });
  const json = (b: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(b), { status }));
  if (method === 'POST') return refus ? json({ error: refus }, 400) : json({ campagneId: 'c42' });
  return json({ reponse });
}

beforeEach(() => {
  calls = [];
  refus = null;
  reponse = {
    occurrenceId: 'o1',
    mode: 'relance',
    contactNom: 'Camille Marchand',
    societe: 'Atelier Fictif',
    theme: 'Test de VMA',
    touche: 2,
    etat: 'envoye',
  };
  location.hash = '';
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Carte « Réponse à une campagne » de l’Inbox', () => {
  it('annonce la campagne d’origine et propose de rédiger la réponse', async () => {
    render(<ReponseCampagneCarte slug="simatis" sujetId="s1" />);
    expect(await screen.findByText(/Réponse à une campagne/)).toBeTruthy();
    expect(screen.getByText(/Camille Marchand, Atelier Fictif/)).toBeTruthy();
    expect(screen.getByText(/Test de VMA, touche 2/)).toBeTruthy();
    expect(calls[0]?.url).toBe('/api/i/simatis/prospection/reponses/s1');
  });

  it('ne montre rien quand l’entrée ne répond à aucune campagne', async () => {
    reponse = null;
    const { container } = render(<ReponseCampagneCarte slug="simatis" sujetId="s2" />);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(container.textContent).toBe('');
  });

  it('crée le brouillon de réponse puis ouvre la campagne dans la Prospection', async () => {
    render(<ReponseCampagneCarte slug="simatis" sujetId="s1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rédiger la réponse' }));
    await waitFor(() => expect(location.hash).toBe('#/simatis/prospection/ouvrir/c42'));
    expect(calls.find((c) => c.method === 'POST')?.url).toBe(
      '/api/i/simatis/prospection/reponses/s1/rediger',
    );
  });

  it('affiche le refus du serveur et laisse le bouton disponible', async () => {
    refus = "L'adresse du contact est introuvable.";
    render(<ReponseCampagneCarte slug="simatis" sujetId="s1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rédiger la réponse' }));
    expect(await screen.findByText(/adresse du contact est introuvable/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Rédiger la réponse' }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('ne plante pas quand le serveur ne répond pas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('réseau'))),
    );
    const { container } = render(<ReponseCampagneCarte slug="simatis" sujetId="s1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
});
