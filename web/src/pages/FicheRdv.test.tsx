// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FicheRdv } from './FicheRdv.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let compteRendu: { texte: string; at: string } | null;
let statut: 'a_trier' | 'rdv' | 'ignore';

const rdv = () => ({
  id: 'evt-1',
  titre: 'Point de cadrage',
  debut: '2026-10-12T12:00:00.000Z',
  fin: '2026-10-12T13:00:00.000Z',
  lieu: 'Visio',
  statut,
  contacts: [{ id: 'c1', nom: 'Claire Exemple', detail: 'Société Fictive' }],
  entreprises: [{ id: 'e1', nom: 'Société Fictive' }],
  affaires: [],
  participants: [
    { email: 'claire@exemple.test', contact: { id: 'c1', nom: 'Claire Exemple' } },
    { email: 'jean.dupont@exemple.test', contact: null },
  ],
  compteRendu,
});

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url.includes('/entreprises?q='))
    return json([{ id: 'e2', nom: 'Entreprise Trouvée', ville: null }]);
  if (url.endsWith('/contacts')) return json({ id: 'c9' });
  if (method !== 'GET') return json({ ok: true });
  return json(rdv());
}
const envoi = (fin: string, methode: string) =>
  calls.find((c) => c.method === methode && c.url.endsWith(fin));

describe('FicheRdv', () => {
  beforeEach(() => {
    calls = [];
    compteRendu = null;
    statut = 'a_trier';
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the meeting with its links to the company and the contact', async () => {
    render(<FicheRdv slug="simatis" id="evt-1" />);
    expect(await screen.findByRole('heading', { name: 'Point de cadrage' })).toBeTruthy();
    expect(calls[0]?.url).toBe('/api/i/simatis/rendez-vous/evt-1');
    expect(screen.getByRole('link', { name: 'Société Fictive' }).getAttribute('href')).toBe(
      '#/simatis/fiche/entreprise/e1',
    );
    // Once in the contacts card, once among the guests.
    for (const a of screen.getAllByRole('link', { name: 'Claire Exemple' })) {
      expect(a.getAttribute('href')).toBe('#/simatis/fiche/contact/c1');
    }
    expect(screen.getByText('À trier')).toBeTruthy();
  });

  it('marks the block as not being a meeting, and puts it back', async () => {
    render(<FicheRdv slug="simatis" id="evt-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pas un RDV' }));
    await waitFor(() => expect(envoi('/rendez-vous/evt-1', 'PATCH')).toBeTruthy());
    expect(envoi('/rendez-vous/evt-1', 'PATCH')?.body).toEqual({ statut: 'ignore' });
    cleanup();
    statut = 'ignore';
    calls = [];
    render(<FicheRdv slug="simatis" id="evt-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remettre dans les RDV à trier' }));
    await waitFor(() => expect(envoi('/rendez-vous/evt-1', 'PATCH')).toBeTruthy());
    expect(envoi('/rendez-vous/evt-1', 'PATCH')?.body).toEqual({ statut: 'a_trier' });
  });

  it('links another company found by search, and unlinks one', async () => {
    render(<FicheRdv slug="simatis" id="evt-1" />);
    await screen.findByRole('heading', { name: 'Point de cadrage' });
    const organisation = screen.getByRole('heading', { name: 'Organisation' }).closest('section');
    if (!organisation) throw new Error('no card');
    fireEvent.click(within(organisation).getByRole('button', { name: '+ Ajouter' }));
    fireEvent.change(screen.getByLabelText('Rechercher à lier'), { target: { value: 'entre' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Entreprise Trouvée' }));
    await waitFor(() => expect(envoi('/rendez-vous/evt-1/liens', 'POST')).toBeTruthy());
    expect(envoi('/rendez-vous/evt-1/liens', 'POST')?.body).toEqual({
      kind: 'entreprise',
      id: 'e2',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Délier Claire Exemple' }));
    await waitFor(() => expect(envoi('/rendez-vous/evt-1/liens', 'DELETE')).toBeTruthy());
    expect(envoi('/rendez-vous/evt-1/liens', 'DELETE')?.body).toEqual({
      kind: 'contact',
      id: 'c1',
    });
  });

  it('creates the contact of an unknown guest in the meeting organisation, and links it', async () => {
    render(<FicheRdv slug="simatis" id="evt-1" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Créer le contact jean.dupont@exemple.test' }),
    );
    await waitFor(() => expect(envoi('/rendez-vous/evt-1/liens', 'POST')).toBeTruthy());
    expect(envoi('/contacts', 'POST')?.body).toEqual({
      nom: 'Jean Dupont',
      email: 'jean.dupont@exemple.test',
      entrepriseId: 'e1',
    });
    expect(envoi('/rendez-vous/evt-1/liens', 'POST')?.body).toEqual({ kind: 'contact', id: 'c9' });
  });

  it('saves the compte rendu, with the task and the second brain checked by default', async () => {
    render(<FicheRdv slug="simatis" id="evt-1" />);
    fireEvent.change(await screen.findByLabelText('Compte rendu'), {
      target: { value: 'Décision : phase deux.' },
    });
    fireEvent.click(screen.getByLabelText('Proposer une tâche « prochaine étape »'));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le compte rendu' }));
    await waitFor(() => expect(envoi('/rendez-vous/evt-1/compte-rendu', 'POST')).toBeTruthy());
    expect(envoi('/rendez-vous/evt-1/compte-rendu', 'POST')?.body).toEqual({
      titre: 'Point de cadrage',
      texte: 'Décision : phase deux.',
      proposerTache: false,
      versCerveau: true,
    });
  });

  it('shows a saved compte rendu and lets it be edited', async () => {
    compteRendu = { texte: 'Budget validé.', at: '2026-10-12T14:00:00.000Z' };
    statut = 'rdv';
    render(<FicheRdv slug="simatis" id="evt-1" />);
    expect(await screen.findByText('Budget validé.')).toBeTruthy();
    expect(screen.getByText('Compte rendu fait')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Compte rendu').value).toBe('Budget validé.');
  });
});
