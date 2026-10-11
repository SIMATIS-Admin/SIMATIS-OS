// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Taches } from './Taches.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let hubspot = true;
let patchReponse: unknown = null;
let beaucoup = false;
let ensuite = true;
let oppClose: 'gagne' | 'perdu' | null = null;

const tache = (id: string, titre: string, extra: Record<string, unknown> = {}) => ({
  id,
  titre,
  notes: null,
  canal: 'tache',
  type: 'tache',
  avecHeure: false,
  dureeMinutes: null,
  occupe: false,
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
      type: 'appel',
      origine: 'hubspot',
      echeance: '2026-10-13T08:00:00.000Z',
      contact: { id: 'c1', nom: 'Romain Arpin' },
      opportunite: { id: 'o1', titre: 'Affaire Arpin', clos: oppClose },
    }),
    tache('t2', 'Envoyer la plaquette', {
      canal: 'email',
      type: 'email',
      echeance: '2026-10-14T09:00:00.000Z',
    }),
    ...(beaucoup
      ? Array.from({ length: 6 }, (_, k) =>
          tache(`m${k}`, `Relance mail ${k}`, {
            canal: 'email',
            echeance: '2026-10-14T09:00:00.000Z',
          }),
        )
      : []),
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
  if (url === '/api/preferences') return json({ favoris: [], options: { ensuite } });
  if (url === '/api/preferences/options') return json({ options: { ensuite: false } });
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
    beaucoup = false;
    ensuite = true;
    oppClose = null;
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
    expect(within(ligne).getByText('Appel')).toBeTruthy();
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

  describe('activity window', () => {
    const nouvelle = async () => {
      await liste();
      fireEvent.click(screen.getByRole('button', { name: 'Nouvelle tâche' }));
    };
    const post = () => calls.find((c) => c.method === 'POST')?.body as Record<string, unknown>;
    const presse = (nom: string) =>
      screen.getByRole('button', { name: nom }).getAttribute('aria-pressed');

    it('pre-selects the type from the title until a type is clicked', async () => {
      await nouvelle();
      fireEvent.change(screen.getByLabelText('Intitulé'), {
        target: { value: 'Déjeuner avec Agathe' },
      });
      expect(presse('Déjeuner')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'Appel' }));
      fireEvent.change(screen.getByLabelText('Intitulé'), {
        target: { value: 'Déjeuner encore' },
      });
      expect(presse('Appel')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
      await waitFor(() => expect(post()).toBeTruthy());
      expect(post()).toMatchObject({ titre: 'Déjeuner encore', type: 'appel' });
    });

    it('sends no type when none was clicked, and a precise time only when asked', async () => {
      await nouvelle();
      fireEvent.change(screen.getByLabelText('Intitulé'), { target: { value: 'Préparer' } });
      expect(screen.queryByLabelText('Heure')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
      await waitFor(() => expect(post()).toBeTruthy());
      expect(post()).not.toHaveProperty('type');
      expect(post()).toMatchObject({ avecHeure: false });

      calls = [];
      fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle tâche' }));
      fireEvent.change(screen.getByLabelText('Intitulé'), { target: { value: 'Point' } });
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-15' } });
      fireEvent.click(screen.getByLabelText('Heure précise'));
      fireEvent.change(screen.getByLabelText('Heure'), { target: { value: '14:30' } });
      fireEvent.change(screen.getByLabelText('Durée'), { target: { value: '60' } });
      fireEvent.click(screen.getByLabelText('Occupé'));
      fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
      await waitFor(() => expect(post()).toBeTruthy());
      expect(post()).toMatchObject({
        avecHeure: true,
        dureeMinutes: 60,
        occupe: true,
        echeance: '2026-10-15T12:30:00.000Z',
      });
    });

    it('offers the next activity when one is marked done, linked to the same deal', async () => {
      await liste();
      fireEvent.click(screen.getByLabelText('Marquer faite : Appeler Romain Arpin'));
      const fenetre = await screen.findByRole('dialog', { name: 'Et ensuite ?' });
      expect(
        within(fenetre).getByRole('button', { name: 'Appel' }).getAttribute('aria-pressed'),
      ).toBe('true');
      fireEvent.change(within(fenetre).getByLabelText('Intitulé'), {
        target: { value: 'Rappeler Romain' },
      });
      fireEvent.click(within(fenetre).getByRole('button', { name: 'Planifier' }));
      await waitFor(() => expect(post()).toBeTruthy());
      expect(post()).toMatchObject({
        titre: 'Rappeler Romain',
        type: 'appel',
        contactId: 'c1',
        opportuniteId: 'o1',
        hubspot: true,
      });
    });

    it('can stop offering the next activity', async () => {
      await liste();
      fireEvent.click(screen.getByLabelText('Marquer faite : Appeler Romain Arpin'));
      const fenetre = await screen.findByRole('dialog', { name: 'Et ensuite ?' });
      fireEvent.click(within(fenetre).getByLabelText('Ne plus me proposer'));
      fireEvent.click(within(fenetre).getByRole('button', { name: 'Pas maintenant' }));
      await waitFor(() =>
        expect(calls.find((c) => c.url === '/api/preferences/options')).toMatchObject({
          method: 'PUT',
          body: { ensuite: false },
        }),
      );
      expect(screen.queryByRole('dialog', { name: 'Et ensuite ?' })).toBeNull();
    });

    it('offers nothing when disabled or when the deal is closed', async () => {
      ensuite = false;
      await liste();
      fireEvent.click(screen.getByLabelText('Marquer faite : Appeler Romain Arpin'));
      await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
      expect(screen.queryByRole('dialog', { name: 'Et ensuite ?' })).toBeNull();
      cleanup();

      ensuite = true;
      oppClose = 'perdu';
      calls = [];
      await liste();
      fireEvent.click(screen.getByLabelText('Marquer faite : Appeler Romain Arpin'));
      await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
      expect(screen.queryByRole('dialog', { name: 'Et ensuite ?' })).toBeNull();
    });
  });

  describe('week view', () => {
    const dt = (id: string) => ({
      types: ['application/x-simatis-tache'],
      getData: () => id,
      setData: () => undefined,
    });
    const jour = (d: string) => document.querySelector(`[data-jour="${d}"]`) as HTMLElement;
    const patch = () => calls.find((c) => c.method === 'PATCH');
    const semaineAffichee = async () => {
      render(<Taches slug="simatis" />);
      await screen.findByText('Appeler Romain Arpin');
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows the week number, one column per day, tasks grouped by type and meetings', async () => {
      await semaineAffichee();
      expect(calls[0]?.url).toBe('/api/i/simatis/taches?du=2026-10-12&au=2026-10-18');
      expect(screen.getByText('Semaine 42 · 12 – 18 octobre 2026')).toBeTruthy();
      for (const j of ['Lun 12', 'Mar 13', 'Mer 14', 'Jeu 15', 'Ven 16', 'Week-end']) {
        expect(screen.getByText(j)).toBeTruthy();
      }
      const mardi = jour('2026-10-13');
      expect(within(mardi).getByText('Téléphone (1)')).toBeTruthy();
      expect(within(mardi).getByText('Appeler Romain Arpin')).toBeTruthy();
      expect(within(mardi).getByText('10:00')).toBeTruthy();
      const jeudi = jour('2026-10-15');
      expect(within(jeudi).getByText('Déjeuner Fonderie').closest('.rdv')).toBeTruthy();
      expect(within(jeudi).getByText('14:00')).toBeTruthy();
    });

    it('changes week with the buttons and the keyboard arrows', async () => {
      await semaineAffichee();
      fireEvent.click(screen.getByRole('button', { name: 'Semaine suivante' }));
      await waitFor(() => expect(calls.at(-1)?.url).toContain('du=2026-10-19&au=2026-10-25'));
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      await waitFor(() => expect(calls.at(-1)?.url).toContain('du=2026-10-12'));
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      await waitFor(() => expect(calls.at(-1)?.url).toContain('du=2026-10-05'));
      fireEvent.click(screen.getByRole('button', { name: 'Cette semaine' }));
      await waitFor(() => expect(calls.at(-1)?.url).toContain('du=2026-10-12'));
    });

    it('moves a task to another day, keeping its time', async () => {
      await semaineAffichee();
      fireEvent.dragOver(jour('2026-10-16'), { dataTransfer: dt('t2') });
      fireEvent.drop(jour('2026-10-16'), { dataTransfer: dt('t2') });
      await waitFor(() => expect(patch()).toBeTruthy());
      expect(patch()).toMatchObject({
        url: '/api/i/simatis/taches/t2',
        body: { echeance: '2026-10-16T09:00:00.000Z' },
      });
    });

    it('pushes a task back one week when dropped on the next-week button', async () => {
      await semaineAffichee();
      fireEvent.drop(screen.getByRole('button', { name: 'Semaine suivante' }), {
        dataTransfer: dt('t1'),
      });
      await waitFor(() => expect(patch()).toBeTruthy());
      expect(patch()?.body).toEqual({ echeance: '2026-10-20T08:00:00.000Z' });
    });

    it('lists overdue tasks aside, oldest first, and reschedules them to today', async () => {
      await semaineAffichee();
      const colonne = screen.getByRole('complementary', { name: 'En retard' });
      expect(within(colonne).getByText('En retard (1)')).toBeTruthy();
      const ligne = within(colonne).getByText('Relancer Fonderie').closest('li') as HTMLElement;
      expect(within(ligne).getByText('il y a 6 j')).toBeTruthy();
      fireEvent.click(within(ligne).getByRole('button', { name: 'Aujourd’hui' }));
      await waitFor(() => expect(patch()).toBeTruthy());
      expect(patch()).toMatchObject({
        url: '/api/i/simatis/taches/t4',
        body: { echeance: '2026-10-14T08:00:00.000Z' },
      });
    });

    it('reschedules all overdue tasks after confirmation, and folds the column', async () => {
      const confirm = vi.fn(() => true);
      vi.stubGlobal('confirm', confirm);
      await semaineAffichee();
      fireEvent.click(screen.getByRole('button', { name: 'Tout reporter à aujourd’hui' }));
      expect(confirm).toHaveBeenCalled();
      await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1));
      fireEvent.click(screen.getByRole('button', { name: 'Replier la colonne En retard' }));
      expect(screen.queryByText('Relancer Fonderie')).toBeNull();
      expect(screen.getByRole('button', { name: 'En retard (1)' })).toBeTruthy();
    });

    it('folds a group of more than five tasks and hides a shared default time', async () => {
      beaucoup = true;
      await semaineAffichee();
      const mercredi = jour('2026-10-14');
      expect(within(mercredi).getByText('Email (7)')).toBeTruthy();
      expect(within(mercredi).getAllByText(/Relance mail|Envoyer la plaquette/)).toHaveLength(5);
      expect(within(mercredi).queryByText('11:00')).toBeNull();
      fireEvent.click(within(mercredi).getByRole('button', { name: '+ 2 autres' }));
      expect(within(mercredi).getAllByText(/Relance mail|Envoyer la plaquette/)).toHaveLength(7);
    });

    it('explains when a move was only simulated in HubSpot', async () => {
      patchReponse = { simulation: true, message: 'Simulation : rien n’a été écrit dans HubSpot.' };
      await semaineAffichee();
      fireEvent.drop(jour('2026-10-16'), { dataTransfer: dt('t1') });
      expect(await screen.findByText(/Simulation : rien n’a été écrit/)).toBeTruthy();
    });
  });
});
