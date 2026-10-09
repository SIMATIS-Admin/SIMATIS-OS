// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AValider } from './AValider.js';
import { Brief } from './Brief.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

const compte = (total = 0) => ({ email: total, appel: 0, autre: 0, total });
const brief = {
  source: 'natif',
  rdv: [
    {
      debut: '2026-10-08T08:00:00Z',
      fin: '2026-10-08T09:00:00Z',
      titre: 'Point Fonderie',
      lieu: 'Rumilly',
    },
  ],
  rdvEtat: 'ok',
  taches: [
    {
      id: 't1',
      titre: 'Relancer Ateliers Morvan',
      canal: 'email',
      echeance: null,
      prepare: true,
      source: 'natif',
      contact: 'Hélène Morvan',
      entreprise: 'Ateliers Morvan',
      opportunite: null,
      situation: 'retard',
    },
    {
      id: 't2',
      titre: 'Appeler Lumibat',
      canal: 'appel',
      echeance: null,
      prepare: false,
      source: 'natif',
      contact: null,
      entreprise: null,
      opportunite: null,
      situation: 'jour',
    },
  ],
  realisees: {
    veille: { jour: '2026-10-07', ...compte(3) },
    semaine: compte(9),
    mois: compte(30),
    aujourdhui: compte(0),
  },
};
const propositions = [
  {
    id: 'p1',
    type: 'email.brouillon',
    contenu: {
      to: 'h.morvan@ateliers-morvan.fr',
      objet: 'Votre proposition',
      corps: '<p>Bonjour Madame Morvan,</p><script>alert(1)</script>',
      origine: 'Routine quotidienne',
      controles: ['Pas de réponse au dernier message'],
    },
    auteur: 'os',
    statut: 'proposee',
    niveau: 'L1',
    decidePar: null,
    resultat: null,
    createdAt: '2026-10-08T06:00:00Z',
    action: "Créer un brouillon d'email",
    contact: { id: 'c1', nom: 'Hélène Morvan', entreprise: 'Ateliers Morvan' },
  },
];

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url.includes('/fait')) return json({ simulation: false });
  if (url.includes('/decision')) return json({ ...propositions[0], statut: 'appliquee' });
  if (url.includes('/brief')) return json(brief);
  return json(propositions);
}

describe('pilot screens', () => {
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('brief: meetings, overdue tasks, prepared draft badge and counts', async () => {
    render(<Brief slug="simatis" />);
    expect(await screen.findByText('Relancer Ateliers Morvan')).toBeTruthy();
    expect(screen.getByText(/Point Fonderie/)).toBeTruthy();
    expect(screen.getByText('En retard')).toBeTruthy();
    expect(screen.getByText('Brouillon prêt dans Gmail')).toBeTruthy();
    expect(screen.getByText('Emails (1)')).toBeTruthy();

    fireEvent.click(screen.getByText('Appels (1)'));
    expect(screen.queryByText('Relancer Ateliers Morvan')).toBeNull();
    expect(screen.getByText('Appeler Lumibat')).toBeTruthy();
  });

  it('brief: marks a task done on the server', async () => {
    render(<Brief slug="simatis" />);
    fireEvent.click((await screen.findAllByText('Marquer fait'))[0] as HTMLElement);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/taches/t1/fait'))).toBe(true));
  });

  it('queue: shows the draft safely and validates it with the edited text', async () => {
    const { container } = render(<AValider slug="simatis" />);
    expect(await screen.findByText('Créer le brouillon dans Gmail')).toBeTruthy();
    expect(container.querySelector('.mail-b')?.innerHTML).toBe('<p>Bonjour Madame Morvan,</p>');
    expect(screen.getByText('Pas de réponse au dernier message')).toBeTruthy();

    fireEvent.click(screen.getByText('Modifier le texte'));
    fireEvent.change(screen.getByLabelText('Texte du brouillon'), {
      target: { value: '<p>Nouveau texte</p>' },
    });
    fireEvent.click(screen.getByText('Créer le brouillon dans Gmail'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/i/simatis/propositions/p1/decision',
      body: {
        decision: 'valider',
        contenu: { corps: '<p>Nouveau texte</p>', objet: 'Votre proposition' },
      },
    });
  });

  it('queue: discards without content', async () => {
    render(<AValider slug="simatis" />);
    fireEvent.click(await screen.findByText('Écarter'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decision: 'ecarter' });
  });
});
