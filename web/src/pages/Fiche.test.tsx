// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Fiche } from './Fiche.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
// Present (null or a mandate) only for a deal of the own activity.
let mandat: { slug: string; nom: string } | null | undefined;

const affaire = () => ({
  kind: 'affaire',
  fiche: {
    id: 'o1',
    titre: 'Structuration commerciale',
    montant: 14000,
    echeance: '2026-11-15',
    etape: 'qualifiedtobuy',
    clos: null,
    origine: 'hubspot',
    qualification: null,
  },
  liens: {
    entreprise: { id: 'e1', nom: 'Fonderie Vallière' },
    contact: { id: 'c1', nom: 'Agathe Vallière' },
  },
  aVenir: [
    {
      id: 't1',
      titre: 'Relancer Agathe',
      type: 'appel',
      canal: 'appel',
      echeance: '2026-10-16T08:00:00.000Z',
      fait: false,
      origine: 'hubspot',
      avecHeure: false,
      dureeMinutes: null,
      occupe: false,
      notes: null,
      contact: null,
      opportunite: null,
    },
  ],
  historique: [
    {
      id: 'n1',
      type: 'note',
      titre: null,
      texte: 'Budget validé',
      at: '2026-10-03T14:00:00.000Z',
      origine: 'hubspot',
    },
    {
      id: 'a1',
      type: 'appel',
      titre: 'Appel découverte',
      texte: null,
      at: '2026-09-28T09:00:00.000Z',
      origine: 'hubspot',
    },
    {
      id: 'etape-q',
      type: 'etape',
      titre: 'Qualifié',
      texte: null,
      at: '2026-10-01T08:00:00.000Z',
      origine: 'hubspot',
    },
  ],
  etapes: [
    { id: 'appointmentscheduled', label: 'Rendez-vous planifié', probabilite: 20, jours: 11 },
    { id: 'qualifiedtobuy', label: 'Qualifié', probabilite: 40, jours: 13 },
    { id: 'presentationscheduled', label: 'Proposition', probabilite: 60, jours: null },
  ],
  ecrit: true,
});

const contact = () => ({
  kind: 'contact',
  fiche: { id: 'c1', nom: 'Agathe Vallière', email: 'a@fonderie.example', origine: 'os' },
  liens: {
    entreprise: { id: 'e1', nom: 'Fonderie Vallière' },
    affaires: [{ id: 'o1', titre: 'Structuration', etape: 'q', clos: null, montant: 14000 }],
  },
  aVenir: [],
  historique: [],
  ecrit: true,
});

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url.includes('/recherche'))
    return json({
      affaires: [],
      personnes: [{ id: 'c2', nom: 'Agathe Vallière (doublon)', entreprise: null }],
      organisations: [],
    });
  if (url.includes('/fiches/contact/')) return json(contact());
  if (url.endsWith('/mandat') || url.endsWith('/mandat/lier'))
    return json({ slug: 'beta', nom: 'Beta', type: 'mandat', phase: 'closing' });
  if (url === '/api/instances')
    return json([
      { slug: 'simatis', nom: 'SIMATIS', type: 'propre', phase: null },
      { slug: 'beta', nom: 'Beta', type: 'mandat', phase: 'en_cours' },
      { slug: 'demo', nom: 'Démo', type: 'prospect', phase: null },
    ]);
  if (url.includes('/fiches/affaire/') && mandat !== undefined)
    return json({ ...affaire(), mandat });
  if (url.includes('/opportunites/')) return json({ opportunite: {}, simulation: false });
  if (url.includes('/preferences')) return json({ favoris: [], options: { ensuite: true } });
  return json(affaire());
}

const patch = (fin: string) => calls.find((c) => c.method === 'PATCH' && c.url.endsWith(fin));

describe('Fiche page', () => {
  beforeEach(() => {
    calls = [];
    mandat = undefined;
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows a deal with its stage bar, days per stage, links and history', async () => {
    render(<Fiche slug="simatis" kind="affaire" id="o1" />);
    expect(await screen.findByRole('heading', { name: 'Structuration commerciale' })).toBeTruthy();
    expect(calls[0]?.url).toBe('/api/i/simatis/fiches/affaire/o1');
    expect(screen.getByText('11 j')).toBeTruthy();
    expect(screen.getByText('13 j')).toBeTruthy();
    for (const a of screen.getAllByRole('link', { name: 'Fonderie Vallière' })) {
      expect(a.getAttribute('href')).toBe('#/simatis/fiche/entreprise/e1');
    }
    expect(screen.getByText('Relancer Agathe')).toBeTruthy();
    expect(screen.getByText('Budget validé')).toBeTruthy();
  });

  it('shows « + Ajouter » on the people and deals cards, even empty', async () => {
    render(<Fiche slug="simatis" kind="contact" id="c1" />);
    expect(await screen.findByRole('heading', { name: 'Agathe Vallière' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Organisations (1)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Affaires (1)' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '+ Ajouter' })).toHaveLength(2);
  });

  it('lists every person and organisation of a deal', async () => {
    render(<Fiche slug="simatis" kind="affaire" id="o1" />);
    expect(await screen.findByRole('heading', { name: 'Personnes (1)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Organisations (1)' })).toBeTruthy();
  });

  it('creates the mandate of a deal of the own activity in two clicks', async () => {
    mandat = null;
    render(<Fiche slug="simatis" kind="affaire" id="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Créer le mandat' }));
    expect(calls.some((c) => c.url.endsWith('/mandat'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la création' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/i/simatis/opportunites/o1/mandat',
        method: 'POST',
        body: { crm: 'hubspot' },
      }),
    );
  });

  it('links the deal to an existing mandate, demos excluded', async () => {
    mandat = null;
    render(<Fiche slug="simatis" kind="affaire" id="o1" />);
    const choix = await screen.findByLabelText('Mandat existant');
    expect(within(choix).queryByText('Démo')).toBeNull();
    fireEvent.change(choix, { target: { value: 'beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lier à un mandat existant' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/i/simatis/opportunites/o1/mandat/lier',
        method: 'POST',
        body: { slug: 'beta' },
      }),
    );
  });

  it('shows the linked mandate instead of the buttons', async () => {
    mandat = { slug: 'beta', nom: 'Beta' };
    render(<Fiche slug="simatis" kind="affaire" id="o1" />);
    const lienMandat = await screen.findByRole('link', { name: 'Beta' });
    expect(lienMandat.getAttribute('href')).toBe('#/beta/brief');
    expect(screen.queryByRole('button', { name: 'Créer le mandat' })).toBeNull();
  });

  it('offers no mandate panel outside the own activity or on a contact', async () => {
    render(<Fiche slug="helioval" kind="affaire" id="o1" />);
    await screen.findByRole('heading', { name: 'Structuration commerciale' });
    expect(screen.queryByRole('button', { name: 'Créer le mandat' })).toBeNull();
    cleanup();
    mandat = null;
    render(<Fiche slug="simatis" kind="contact" id="c1" />);
    await screen.findByRole('heading', { name: 'Agathe Vallière' });
    expect(screen.queryByRole('button', { name: 'Créer le mandat' })).toBeNull();
  });

  it('moves the deal to a stage from the bar', async () => {
    render(<Fiche slug="simatis" kind="affaire" id="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: "Passer à l'étape Proposition" }));
    await waitFor(() => expect(patch('/opportunites/o1')).toBeTruthy());
    expect(patch('/opportunites/o1')?.body).toEqual({ etape: 'presentationscheduled' });
  });

  it('edits a field in place with the pencil, Enter saves', async () => {
    render(<Fiche slug="simatis" kind="affaire" id="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier Valeur' }));
    const champ = screen.getByLabelText('Valeur');
    fireEvent.change(champ, { target: { value: '18000' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    await waitFor(() => expect(patch('/fiches/affaire/o1')).toBeTruthy());
    expect(patch('/fiches/affaire/o1')?.body).toEqual({ montant: 18000 });
  });

  it('adds a note, also in HubSpot by default for a HubSpot record', async () => {
    render(<Fiche slug="simatis" kind="affaire" id="o1" />);
    fireEvent.change(await screen.findByLabelText('Note'), { target: { value: 'Devis envoyé' } });
    expect(screen.getByLabelText<HTMLInputElement>('Aussi dans HubSpot').checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la note' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/notes'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/notes'))?.body).toEqual({
      corps: 'Devis envoyé',
      hubspot: true,
    });
  });

  it('asks the reason before marking the deal lost', async () => {
    render(<Fiche slug="simatis" kind="affaire" id="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Perdue' }));
    const modal = await screen.findByRole('dialog');
    fireEvent.change(within(modal).getByLabelText('Motif'), {
      target: { value: 'Projet abandonné' },
    });
    fireEvent.click(within(modal).getByText('Clôturer'));
    await waitFor(() => expect(patch('/opportunites/o1')).toBeTruthy());
    expect(patch('/opportunites/o1')?.body).toEqual({ clos: 'perdu', motif: 'Projet abandonné' });
  });

  it('filters the history by kind', async () => {
    render(<Fiche slug="simatis" kind="affaire" id="o1" />);
    await screen.findByText('Budget validé');
    fireEvent.click(screen.getByRole('button', { name: 'Appels' }));
    expect(screen.queryByText('Budget validé')).toBeNull();
    expect(screen.getByText('Appel découverte')).toBeTruthy();
  });

  it('shows a contact with its company and deals as links', async () => {
    render(<Fiche slug="simatis" kind="contact" id="c1" />);
    expect(await screen.findByRole('heading', { name: 'Agathe Vallière' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Structuration' }).getAttribute('href')).toBe(
      '#/simatis/fiche/affaire/o1',
    );
    expect(screen.queryByLabelText('Aussi dans HubSpot')).toBeNull();
  });

  it('deletes the record after a confirmation', async () => {
    render(<Fiche slug="simatis" kind="contact" id="c1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'DELETE')?.url).toBe(
        '/api/i/simatis/fiches/contact/c1',
      ),
    );
  });

  it('merges with another record found by name, keeping the chosen one', async () => {
    render(<Fiche slug="simatis" kind="contact" id="c1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fusionner avec…' }));
    fireEvent.change(screen.getByLabelText('Rechercher la fiche à fusionner'), {
      target: { value: 'agathe' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Agathe Vallière (doublon)' }));
    const confirmer = screen.getByRole('button', { name: 'Confirmer la fusion' });
    expect((confirmer as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Agathe Vallière (doublon)'));
    fireEvent.click(confirmer);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/fusion'))).toMatchObject({
        url: '/api/i/simatis/fiches/contact/c2/fusion',
        body: { absorbeId: 'c1' },
      }),
    );
    expect(location.hash).toBe('#/simatis/fiche/contact/c2');
  });
});
