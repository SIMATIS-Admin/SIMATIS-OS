// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Barre } from './Barre.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url.includes('/recherche?q='))
    return json({
      affaires: [{ id: 'o1', titre: 'Structuration', entreprise: 'Fonderie Vallière', clos: null }],
      personnes: [{ id: 'c1', nom: 'Agathe Vallière', entreprise: 'Fonderie Vallière' }],
      organisations: [{ id: 'e1', nom: 'Fonderie Vallière', ville: 'Rumilly' }],
    });
  if (url.endsWith('/pipeline'))
    return json({ etapes: [{ id: 'qualification', label: 'Qualification' }], opportunites: [] });
  if (method === 'POST' && url.endsWith('/opportunites')) return json({ id: 'o9' });
  return json([]);
}

describe('Barre (recherche globale et ajout rapide)', () => {
  beforeEach(() => {
    calls = [];
    location.hash = '';
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('searches deals, people and organisations, and opens the chosen one', async () => {
    render(<Barre slug="simatis" />);
    fireEvent.change(screen.getByLabelText('Recherche globale'), { target: { value: 'vall' } });
    const resultats = await screen.findByRole('listbox');
    expect(within(resultats).getByText('Affaires')).toBeTruthy();
    expect(within(resultats).getByText('Contacts')).toBeTruthy();
    expect(within(resultats).getByText('Organisations')).toBeTruthy();
    expect(calls.at(-1)?.url).toBe('/api/i/simatis/recherche?q=vall');
    fireEvent.click(within(resultats).getByRole('option', { name: /Agathe Vallière/ }));
    expect(location.hash).toBe('#/simatis/fiche/contact/c1');
  });

  it('opens the first result with Enter', async () => {
    render(<Barre slug="simatis" />);
    const champ = screen.getByLabelText('Recherche globale');
    fireEvent.change(champ, { target: { value: 'vall' } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(champ, { key: 'Enter' });
    expect(location.hash).toBe('#/simatis/fiche/affaire/o1');
  });

  it('adds a deal from the quick-add menu, in the first stage', async () => {
    render(<Barre slug="simatis" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajout rapide' }));
    expect(screen.getByRole('menuitem', { name: 'Contact' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Organisation' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Activité' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Affaire' }));
    const modal = await screen.findByRole('dialog', { name: 'Nouvelle affaire' });
    fireEvent.change(within(modal).getByLabelText('Titre'), { target: { value: 'Audit' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/i/simatis/opportunites',
      body: { titre: 'Audit', etape: 'qualification' },
    });
    await waitFor(() => expect(location.hash).toBe('#/simatis/fiche/affaire/o9'));
  });

  it('opens the new organisation window from the menu', async () => {
    render(<Barre slug="simatis" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajout rapide' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Organisation' }));
    expect(await screen.findByRole('dialog', { name: 'Nouvelle entreprise' })).toBeTruthy();
  });
});
