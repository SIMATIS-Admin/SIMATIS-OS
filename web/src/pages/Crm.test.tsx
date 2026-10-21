// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Contacts } from './Contacts.js';
import { Entreprises } from './Entreprises.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

const ENTREPRISES = [
  {
    id: 'e1',
    nom: 'Plasturgie Mornand',
    secteur: 'Plasturgie',
    ville: 'Oyonnax',
    taille: 64,
    domaine: 'mornand-plasturgie.fr',
    nbContacts: 1,
    oppsOuvertes: 1,
    montantOuvert: 18000,
  },
];
const FICHE = {
  ...ENTREPRISES[0],
  contacts: [{ id: 'c1', nom: 'Karim Haddad', fonction: 'Directeur général', role: 'Décideur' }],
  opportunites: [
    {
      id: 'o1',
      titre: 'Plan d’action commercial',
      etape: 'qualification',
      montant: 18000,
      echeance: null,
      clos: null,
      motif: null,
    },
  ],
};

function fakeFetch(input: string, init?: { method?: string; body?: string }) {
  const url = input;
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (method === 'POST') return json({ id: 'c-new', nom: 'Nouvelle' }, 201);
  if (url.includes('/entreprises/e1')) return json(FICHE);
  if (url.includes('/entreprises')) return json(ENTREPRISES);
  if (url.includes('/contacts')) return json([]);
  return json({ error: 'inconnu' }, 404);
}

describe('CRM screens', () => {
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists companies with their open deals and searches on the server', async () => {
    render(<Entreprises slug="simatis" />);
    expect(await screen.findByText('Plasturgie Mornand')).toBeTruthy();
    // Pipedrive list: open deals and their value in their own columns.
    expect(screen.getByText(/18\s000 €/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Trier par Affaires ouvertes' })).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'plast' } });
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('entreprises?q=plast'))).toBe(true),
    );
  });

  it('opens the company page, Pipedrive-like', async () => {
    render(<Entreprises slug="simatis" />);
    fireEvent.click(await screen.findByText('Plasturgie Mornand'));
    expect(location.hash).toBe('#/simatis/fiche/entreprise/e1');
  });

  it('creates a contact attached to a company', async () => {
    render(<Contacts slug="aquaterra" />);
    fireEvent.click(await screen.findByText('Nouveau contact'));
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Paul Brunet' } });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'p.brunet@exemple.test' },
    });
    await screen.findByRole('option', { name: 'Plasturgie Mornand' });
    fireEvent.change(screen.getByLabelText('Entreprise'), { target: { value: 'e1' } });
    fireEvent.click(screen.getByText('Créer'));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/i/aquaterra/contacts',
      body: { nom: 'Paul Brunet', email: 'p.brunet@exemple.test', entrepriseId: 'e1' },
    });
  });

  it('deletes the selected companies in bulk and reloads the list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: { method?: string; body?: string }) => {
        const method = init?.method ?? 'GET';
        calls.push({
          url,
          method,
          body: init?.body ? (JSON.parse(init.body) as unknown) : undefined,
        });
        if (method === 'POST' && url.endsWith('/fiches/entreprise/supprimer'))
          return Promise.resolve(
            new Response(JSON.stringify({ resultats: [{ id: 'e1', ok: true }] })),
          );
        return fakeFetch(url, init);
      }),
    );
    render(<Entreprises slug="simatis" />);
    fireEvent.click(await screen.findByLabelText('Sélectionner Plasturgie Mornand'));
    const listes = () =>
      calls.filter((c) => c.method === 'GET' && c.url.endsWith('/entreprises?q=')).length;
    const avant = listes();
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la sélection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        url: '/api/i/simatis/fiches/entreprise/supprimer',
        body: { ids: ['e1'] },
      }),
    );
    expect((await screen.findByRole('status')).textContent).toContain('1 supprimée');
    await waitFor(() => expect(listes()).toBeGreaterThan(avant));
  });
});
