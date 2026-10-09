// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutinesParametres } from './parametres/Routines.js';
import { Routines } from './Routines.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let polls = 0;

const routine = {
  cle: 'quotidienne',
  nom: 'Routine quotidienne de relance',
  etapes: ['Lire les tâches de relance échues et du jour', 'Rédiger les brouillons, à valider'],
  skill: 'relance-quotidienne',
  actif: true,
  params: { heure: '7h00', jours: 'Jours ouvrés', canaux: ['email', 'appel'], max: 20 },
  rythme: 'Chaque jour ouvré à 7h00, ou à la demande',
  derniere: null,
};
const execution = (statut: string, extra: object = {}) => ({
  id: 'e1',
  routine: 'quotidienne',
  statut,
  demandePar: 'pilote',
  debut: null,
  fin: null,
  createdAt: '2026-10-09T06:00:00Z',
  etapes: [],
  rapport: null,
  ...extra,
});

const sante = {
  executeur: { actif: false, poste: null, vuLe: null },
  routines: [
    {
      cle: 'quotidienne',
      nom: 'Routine quotidienne de relance',
      skill: 'relance-quotidienne',
      actif: true,
      resume: 'Chaque jour ouvré à 7h00, prépare au plus 20 relances par email.',
      feu: 'manque',
      controles: [
        {
          id: 'executeur',
          libelle: "L'exécuteur tourne sur l'ordinateur",
          etat: 'manque',
          detail: "Il n'a jamais tourné.",
          action: 'executeur',
        },
        {
          id: 'messagerie',
          libelle: 'Messagerie branchée',
          etat: 'attention',
          detail: "Sans elle, la routine s'arrête.",
          action: 'connexions',
        },
      ],
      etapes: [
        { texte: 'Lire les tâches', besoin: null, bloquee: false },
        { texte: "Vérifier l'historique", besoin: 'messagerie', bloquee: true },
      ],
      derniere: null,
    },
  ],
};

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url.endsWith('/executions') && method === 'POST') return json(execution('demandee'));
  if (url.endsWith('/executions/e1')) {
    polls += 1;
    return json(
      polls < 2
        ? execution('en_cours', {
            etapes: [{ etape: 'Lire les tâches', statut: 'fait', at: '2026-10-09T06:00:01Z' }],
          })
        : execution('terminee', {
            rapport: { fait: ['3 brouillons proposés'], attente: ['3 à valider'], echec: [] },
          }),
    );
  }
  if (url.endsWith('/routines/sante')) return json(sante);
  if (method === 'PATCH') return json(routine);
  return json([routine]);
}

describe('Routines Claude screens', () => {
  beforeEach(() => {
    calls = [];
    polls = 0;
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('launches a routine and follows it step by step until its report', async () => {
    render(<Routines slug="demo" />);
    fireEvent.click(await screen.findByText('Lancer maintenant'));
    expect(await screen.findByText('Lire les tâches', {}, { timeout: 4000 })).toBeTruthy();
    expect(await screen.findByText('3 brouillons proposés', {}, { timeout: 4000 })).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.url).toBe(
      '/api/i/demo/routines/quotidienne/executions',
    );
  }, 10_000);

  it('pauses a routine', async () => {
    render(<Routines slug="demo" />);
    fireEvent.click(await screen.findByLabelText('Active'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ actif: false });
  });

  it('shows what is missing, the blocked steps, and leads to the fix', async () => {
    const onConnexions = vi.fn();
    render(<RoutinesParametres slug="demo" onConnexions={onConnexions} />);
    expect(await screen.findByText('Ne peut pas tourner')).toBeTruthy();
    expect(screen.getByText(/0 routine sur 1 prête/)).toBeTruthy();
    expect(screen.getByText(/s'arrête ici : messagerie non branchée/)).toBeTruthy();
    fireEvent.click(screen.getByText('Brancher dans Connexions'));
    expect(onConnexions).toHaveBeenCalled();
  });

  it('saves a setting as soon as it changes', async () => {
    render(<RoutinesParametres slug="demo" />);
    fireEvent.click(await screen.findByLabelText('Appels'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/i/demo/routines/quotidienne',
      body: { params: { canaux: ['email'] } },
    });
  });
});
