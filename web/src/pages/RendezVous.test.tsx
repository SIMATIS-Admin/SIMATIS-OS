// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RendezVous } from './RendezVous.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

const bloc = (id: string, titre: string, statut: string, extra: object = {}) => ({
  id,
  debut: '2026-10-01T08:00:00Z',
  fin: '2026-10-01T09:00:00Z',
  titre,
  lieu: null,
  statut,
  contact: null,
  entreprise: null,
  lienManuel: false,
  opportunite: null,
  compteRendu: false,
  ...extra,
});
const reponse = () => ({
  etat: 'ok',
  rdv: [
    bloc('b1', 'Déjeuner fictif', 'a_trier'),
    bloc('b2', 'Point suggéré', 'a_trier', {
      contact: { id: 'c1', nom: 'Claire Exemple', entreprise: 'Société Fictive' },
      entreprise: { id: 'e1', nom: 'Société Fictive' },
    }),
    bloc('b3', 'Rencontre liée', 'rdv', {
      entreprise: { id: 'e1', nom: 'Société Fictive' },
      compteRendu: true,
    }),
    bloc('b4', 'Rencontre sans compte rendu', 'rdv'),
    bloc('b5', 'Dentiste fictif', 'ignore'),
  ],
});

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  return json(method === 'GET' ? reponse() : { ok: true });
}
const envoi = (fin: string, methode: string) =>
  calls.filter((c) => c.method === methode && c.url.endsWith(fin));

describe('RendezVous list', () => {
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens on the blocks to sort, with a count on each tab', async () => {
    render(<RendezVous slug="simatis" />);
    expect(await screen.findByText('Déjeuner fictif')).toBeTruthy();
    expect(screen.getByText('Point suggéré')).toBeTruthy();
    expect(screen.queryByText('Rencontre liée')).toBeNull();
    expect(screen.queryByText('Dentiste fictif')).toBeNull();
    for (const t of ['À trier (2)', 'Rendez-vous (2)', 'Sans compte rendu (1)', 'Ignorés (1)']) {
      expect(screen.getByRole('tab', { name: t })).toBeTruthy();
    }
  });

  it('marks a block as not being a meeting', async () => {
    render(<RendezVous slug="simatis" />);
    const ligne = (await screen.findByText('Déjeuner fictif')).closest('tr');
    if (!ligne) throw new Error('no row');
    fireEvent.click(within(ligne).getByRole('button', { name: 'Pas un RDV' }));
    await waitFor(() => expect(envoi('/rendez-vous/b1', 'PATCH')).toHaveLength(1));
    expect(envoi('/rendez-vous/b1', 'PATCH')[0]?.body).toEqual({ statut: 'ignore' });
  });

  it('puts an ignored block back among those to sort', async () => {
    render(<RendezVous slug="simatis" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Ignorés (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remettre à trier' }));
    await waitFor(() => expect(envoi('/rendez-vous/b5', 'PATCH')).toHaveLength(1));
    expect(envoi('/rendez-vous/b5', 'PATCH')[0]?.body).toEqual({ statut: 'a_trier' });
  });

  it('validates the contact suggested by the guests: links it, then makes it a meeting', async () => {
    render(<RendezVous slug="simatis" />);
    const ligne = (await screen.findByText('Point suggéré')).closest('tr');
    if (!ligne) throw new Error('no row');
    fireEvent.click(within(ligne).getByRole('button', { name: 'C’est un RDV' }));
    await waitFor(() => expect(envoi('/rendez-vous/b2', 'PATCH')).toHaveLength(1));
    expect(envoi('/rendez-vous/b2/liens', 'POST').map((c) => c.body)).toEqual([
      { kind: 'contact', id: 'c1' },
      { kind: 'entreprise', id: 'e1' },
    ]);
    expect(envoi('/rendez-vous/b2', 'PATCH')[0]?.body).toEqual({ statut: 'rdv' });
  });

  it('lists the meetings still without compte rendu on their own tab', async () => {
    render(<RendezVous slug="simatis" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Sans compte rendu (1)' }));
    expect(await screen.findByText('Rencontre sans compte rendu')).toBeTruthy();
    expect(screen.queryByText('Rencontre liée')).toBeNull();
  });

  it('shows the links of a meeting as buttons to their records', async () => {
    render(<RendezVous slug="simatis" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Rendez-vous (2)' }));
    const lienEntreprise = await screen.findByRole('link', { name: 'Société Fictive' });
    expect(lienEntreprise.getAttribute('href')).toBe('#/simatis/fiche/entreprise/e1');
  });
});

describe('RendezVous : création dans l’OS', () => {
  let etat: 'ok' | 'erreur' | 'non_configure' = 'erreur';
  let liste: ReturnType<typeof bloc>[] = [];

  beforeEach(() => {
    calls = [];
    location.hash = '';
    etat = 'erreur';
    liste = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: { method?: string; body?: string }) => {
        const method = init?.method ?? 'GET';
        calls.push({
          url,
          method,
          body: init?.body ? (JSON.parse(init.body) as unknown) : undefined,
        });
        const json = (body: unknown, status = 201) =>
          Promise.resolve(new Response(JSON.stringify(body), { status }));
        if (method === 'POST' && url.endsWith('/rendez-vous')) return json({ id: 'os:abc' });
        return json(
          { etat, erreur: 'Google a refusé l’autorisation (400 : invalid_grant)', rdv: liste },
          200,
        );
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offre le bouton même quand Google refuse et que la liste est vide', async () => {
    render(<RendezVous slug="simatis" />);
    expect(await screen.findByText(/invalid_grant/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Nouveau rendez-vous/ })).toBeTruthy();
  });

  it('offre le bouton aussi sans agenda branché', async () => {
    etat = 'non_configure';
    render(<RendezVous slug="simatis" />);
    expect(await screen.findByText(/Agenda non branché/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Nouveau rendez-vous/ })).toBeTruthy();
  });

  it('montre la liste et l’erreur Google ensemble quand il y a des rendez-vous de l’OS', async () => {
    liste = [bloc('os:1', 'Rendez-vous de l’OS', 'rdv')];
    render(<RendezVous slug="simatis" />);
    expect(await screen.findByText('Rendez-vous de l’OS')).toBeTruthy();
    expect(screen.getByText(/invalid_grant/)).toBeTruthy();
  });

  it('crée le rendez-vous puis ouvre sa fiche', async () => {
    render(<RendezVous slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Nouveau rendez-vous/ }));
    const fenetre = await screen.findByRole('dialog');
    const creer = within(fenetre).getByRole('button', { name: 'Créer' });
    expect((creer as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(fenetre).getByLabelText('Titre'), {
      target: { value: 'Point fictif' },
    });
    fireEvent.change(within(fenetre).getByLabelText('Date'), { target: { value: '2026-10-12' } });
    fireEvent.change(within(fenetre).getByLabelText('Heure'), { target: { value: '10:30' } });
    fireEvent.change(within(fenetre).getByLabelText('Lieu'), { target: { value: 'Bureau' } });
    fireEvent.click(creer);
    await waitFor(() => expect(location.hash).toBe('#/simatis/fiche/rdv/os%3Aabc'));
    const envoi = calls.find((c) => c.method === 'POST');
    expect(envoi?.body).toMatchObject({ titre: 'Point fictif', dureeMinutes: 60, lieu: 'Bureau' });
    expect(Date.parse((envoi?.body as { debut: string }).debut)).toBe(
      new Date('2026-10-12T10:30').getTime(),
    );
  });
});
