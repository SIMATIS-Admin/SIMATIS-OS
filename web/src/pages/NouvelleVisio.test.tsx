// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NouvelleVisio } from './NouvelleVisio.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let google: 'ok' | 'simulation' | 'erreur' = 'simulation';

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url === '/api/visio/hote') return json({ hote: 'Simatis' });
  if (url.includes('/entreprises?')) return json([{ id: 'e1', nom: 'Atelier Fictif' }]);
  if (method === 'POST') {
    return json({
      id: 'os:v1',
      titre: 'V - Atelier Fictif x Simatis - Restitution',
      lienVisio: google === 'ok' ? 'https://meet.example/aaa' : null,
      google,
    });
  }
  return json({});
}

async function remplir() {
  render(<NouvelleVisio slug="simatis" onFermer={() => undefined} />);
  const fenetre = await screen.findByRole('dialog');
  fireEvent.change(within(fenetre).getByLabelText('Entreprise'), { target: { value: 'Atel' } });
  fireEvent.click(await within(fenetre).findByRole('button', { name: 'Atelier Fictif' }));
  fireEvent.change(within(fenetre).getByLabelText('Motif'), { target: { value: 'Restitution' } });
  fireEvent.change(within(fenetre).getByLabelText('Date'), { target: { value: '2026-10-12' } });
  fireEvent.change(within(fenetre).getByLabelText('Heure'), { target: { value: '10:30' } });
  fireEvent.change(within(fenetre).getByLabelText('Invités'), {
    target: { value: 'client@exemple.test' },
  });
  return fenetre;
}

describe('NouvelleVisio', () => {
  beforeEach(() => {
    calls = [];
    google = 'simulation';
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('montre l’aperçu du titre selon la nomenclature', async () => {
    const fenetre = await remplir();
    expect(
      await within(fenetre).findByText('V - Atelier Fictif x Simatis - Restitution'),
    ).toBeTruthy();
  });

  it('envoie la demande une seule fois et dit qu’aucune invitation n’est partie en simulation', async () => {
    const fenetre = await remplir();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Créer la visio' }));
    expect(await screen.findByText(/Simulation : aucune invitation envoyée/)).toBeTruthy();
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe('/api/i/simatis/visios');
    expect(posts[0]?.body).toMatchObject({
      entrepriseId: 'e1',
      motif: 'Restitution',
      dureeMinutes: 60,
      invites: ['client@exemple.test'],
    });
  });

  it('prévient quand Google refuse la création', async () => {
    google = 'erreur';
    const fenetre = await remplir();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Créer la visio' }));
    expect(await screen.findByText(/Visio non créée dans Google/)).toBeTruthy();
  });

  it('affiche le lien Meet quand la visio est créée', async () => {
    google = 'ok';
    const fenetre = await remplir();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Créer la visio' }));
    await waitFor(() => expect(screen.getByText('https://meet.example/aaa')).toBeTruthy());
  });
});
