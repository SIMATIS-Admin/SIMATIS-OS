// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Taches } from './Taches.js';
import { vers } from './taches/creneaux.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let hubspot = true;
let patchReponse: unknown = null;

const tache = (id: string, titre: string, extra: Record<string, unknown> = {}) => ({
  id,
  titre,
  notes: null,
  canal: 'tache',
  echeance: null,
  fait: false,
  origine: 'os',
  contact: null,
  opportunite: null,
  ...extra,
});

const semaine = () => ({
  taches: [
    tache('t1', 'Appeler Romain Arpin', {
      canal: 'appel',
      origine: 'hubspot',
      echeance: '2026-10-13T08:00:00.000Z',
      contact: { id: 'c1', nom: 'Romain Arpin' },
    }),
    tache('t2', 'Envoyer la plaquette', { canal: 'email', echeance: '2026-10-14T09:00:00.000Z' }),
    tache('t3', 'Préparer le devis', { echeance: '2026-10-12T09:00:00.000Z', fait: true }),
  ],
  enRetard: [tache('t4', 'Relancer Fonderie', { echeance: '2026-10-08T08:00:00.000Z' })],
  sansEcheance: [tache('t5', 'Trier les cartes de visite')],
  rdv: [
    {
      debut: '2026-10-15T12:00:00.000Z',
      fin: '2026-10-15T13:00:00.000Z',
      titre: 'Déjeuner Fonderie',
      lieu: null,
    },
  ],
  rdvEtat: 'ok',
  hubspot,
  ecrit: true,
});

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (method === 'PATCH') return json(patchReponse ?? tache('t1', 'Appeler Romain Arpin'));
  if (method === 'POST') return json(tache('t9', 'Nouvelle'));
  return json(semaine());
}

const titres = () =>
  [...document.querySelectorAll('.tache-ligne b')].map((b) => b.textContent ?? '');

async function liste() {
  render(<Taches slug="simatis" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Liste' }));
  await screen.findByText('Appeler Romain Arpin');
}

describe('Tâches screen', () => {
  beforeEach(() => {
    calls = [];
    hubspot = true;
    patchReponse = null;
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists open tasks by due date, undated last, with type and origin badges', async () => {
    await liste();
    expect(calls[0]?.url).toMatch(/^\/api\/i\/simatis\/taches\?du=\d{4}-\d{2}-\d{2}&au=/);
    expect(titres()).toEqual([
      'Relancer Fonderie',
      'Appeler Romain Arpin',
      'Envoyer la plaquette',
      'Trier les cartes de visite',
    ]);
    const ligne = screen.getByText('Appeler Romain Arpin').closest('li') as HTMLElement;
    expect(within(ligne).getByText('Téléphone')).toBeTruthy();
    expect(within(ligne).getByText('HubSpot')).toBeTruthy();
    expect(within(ligne).getByText(/Romain Arpin ·/)).toBeTruthy();
  });

  it('filters by type and shows done tasks on demand', async () => {
    await liste();
    fireEvent.click(screen.getByRole('button', { name: 'Email' }));
    expect(titres()).toEqual(['Envoyer la plaquette']);
    fireEvent.click(screen.getByRole('button', { name: 'Tous types' }));
    fireEvent.click(screen.getByRole('button', { name: 'Faites' }));
    expect(titres()).toEqual(['Préparer le devis']);
  });

  it('marks a task done from its checkbox', async () => {
    await liste();
    fireEvent.click(screen.getByLabelText('Marquer faite : Appeler Romain Arpin'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/i/simatis/taches/t1',
      body: { fait: true },
    });
  });

  it('creates an OS task by default, and a HubSpot one when the box is checked', async () => {
    await liste();
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle tâche' }));
    const box = screen.getByLabelText<HTMLInputElement>('Créer aussi dans HubSpot');
    expect(box.checked).toBe(false);
    fireEvent.change(screen.getByLabelText('Intitulé'), { target: { value: 'Appeler Lumibat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/i/simatis/taches',
      body: { titre: 'Appeler Lumibat', hubspot: false },
    });

    calls = [];
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle tâche' }));
    fireEvent.change(screen.getByLabelText('Intitulé'), { target: { value: 'Envoyer le devis' } });
    fireEvent.click(screen.getByLabelText('Créer aussi dans HubSpot'));
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ hubspot: true });
  });

  it('hides the HubSpot box when the instance has no HubSpot', async () => {
    hubspot = false;
    await liste();
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle tâche' }));
    expect(screen.queryByLabelText('Créer aussi dans HubSpot')).toBeNull();
  });

  it('edits a task and says when HubSpot was only simulated', async () => {
    patchReponse = { simulation: true, message: 'Simulation : rien n’a été écrit dans HubSpot.' };
    await liste();
    fireEvent.click(screen.getByText('Appeler Romain Arpin'));
    const titre = screen.getByLabelText<HTMLInputElement>('Intitulé');
    expect(titre.value).toBe('Appeler Romain Arpin');
    fireEvent.change(titre, { target: { value: 'Appeler Romain lundi' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Avant 10 h' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/Simulation : rien n’a été écrit dans HubSpot/)).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      titre: 'Appeler Romain lundi',
      notes: 'Avant 10 h',
    });
  });

  describe('week view', () => {
    const dt = (id: string) => ({
      types: ['application/x-simatis-tache'],
      getData: () => id,
      setData: () => undefined,
    });
    const cellule = (jour: number, ligne: number) =>
      document.querySelector(`[data-jour="${jour}"][data-ligne="${ligne}"]`) as HTMLElement;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows the week, overdue tasks, and meetings in the background', async () => {
      render(<Taches slug="simatis" />);
      await screen.findByText('Appeler Romain Arpin');
      expect(calls[0]?.url).toBe('/api/i/simatis/taches?du=2026-10-12&au=2026-10-18');
      for (const jour of ['Lun 12', 'Mar 13', 'Mer 14', 'Jeu 15', 'Ven 16', 'Week-end']) {
        expect(screen.getByText(jour)).toBeTruthy();
      }
      expect(within(cellule(1, 4)).getByText('Appeler Romain Arpin')).toBeTruthy();
      const enRetard = screen.getByText('En retard').closest('section') as HTMLElement;
      expect(within(enRetard).getByText('Relancer Fonderie')).toBeTruthy();
      expect(screen.getByText('Déjeuner Fonderie').closest('.rdv')).toBeTruthy();
    });

    it('moves a task to another slot by drag and drop', async () => {
      render(<Taches slug="simatis" />);
      await screen.findByText('Appeler Romain Arpin');
      fireEvent.dragOver(cellule(3, 4), { dataTransfer: dt('t2') });
      fireEvent.drop(cellule(3, 4), { dataTransfer: dt('t2') });
      await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
      expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
        url: '/api/i/simatis/taches/t2',
        body: { echeance: vers('2026-10-12', 3, 4) },
      });
    });

    it('keeps a HubSpot task in place and explains when the move was only simulated', async () => {
      patchReponse = { simulation: true, message: 'Simulation : rien n’a été écrit dans HubSpot.' };
      render(<Taches slug="simatis" />);
      await screen.findByText('Appeler Romain Arpin');
      fireEvent.drop(cellule(4, 6), { dataTransfer: dt('t1') });
      expect(await screen.findByText(/Simulation : rien n’a été écrit/)).toBeTruthy();
      expect(within(cellule(1, 4)).getByText('Appeler Romain Arpin')).toBeTruthy();
    });
  });
});
