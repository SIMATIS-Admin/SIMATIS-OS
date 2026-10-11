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
  aFaire: { retard: 4, jour: { email: 2, appel: 3, autre: 1, total: 6 } },
  rdv: [
    {
      debut: '2026-10-08T08:00:00Z',
      fin: '2026-10-08T09:00:00Z',
      titre: 'Point Fonderie',
      lieu: 'Rumilly',
      journee: false,
    },
  ],
  rdvEtat: 'ok',
  realisees: {
    veille: { jour: '2026-10-07', ...compte(3) },
    semaine: compte(9),
    mois: compte(30),
    aujourdhui: compte(0),
  },
  rdvTenus: { veille: 1, semaine: 5, mois: 17 },
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

  it('brief: counters only, linking to the tasks screen, with today meetings', async () => {
    const { container } = render(<Brief slug="simatis" />);
    const retard = (await screen.findByText('Tâches en retard')).closest('a');
    expect(retard?.getAttribute('href')).toBe('#/simatis/taches');
    expect(retard?.textContent).toContain('4');
    const jour = screen.getByText('Tâches du jour').closest('a');
    expect(jour?.getAttribute('href')).toBe('#/simatis/taches');
    expect(jour?.textContent).toMatch(/6.*2 emails.*3 appels.*1 action/);
    expect(screen.getByText(/Point Fonderie/)).toBeTruthy();
    expect(screen.getByText('Rendez-vous et réunions').closest('a')?.textContent).toContain('1');
    // No task list nor "mark done" any more: that is the Tâches screen's job.
    expect(screen.queryByText('Marquer fait')).toBeNull();
    expect(container.querySelectorAll('.vq-filter')).toHaveLength(0);
  });

  it('brief: activity with tasks done and meetings held per period', async () => {
    render(<Brief slug="simatis" />);
    await screen.findByText('30 derniers jours');
    const mois = screen.getByText('30 derniers jours').closest('.activ-row');
    expect(mois?.textContent).toMatch(/30.*tâches.*17 RDV tenus/);
    expect(screen.getByText('Dernier jour ouvré').closest('.activ-row')?.textContent).toContain(
      '1 RDV tenu',
    );
  });

  it('brief: no meetings-held count when the agenda is not connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ...brief, rdv: [], rdvEtat: 'non_configure', rdvTenus: null }),
          ),
        ),
      ),
    );
    render(<Brief slug="simatis" />);
    expect(await screen.findByText('Agenda non connecté')).toBeTruthy();
    expect(screen.queryByText(/RDV tenu/)).toBeNull();
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
