// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TacheVue } from '../../api.js';
import { EditionTache } from './Edition.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let refus: string | null = null;

const tache = (extra: Partial<TacheVue> = {}): TacheVue => ({
  id: 't1',
  titre: 'Relancer Fonderie fictive',
  notes: null,
  canal: 'email',
  type: 'email',
  avecHeure: false,
  dureeMinutes: null,
  occupe: false,
  echeance: '2026-10-14T09:00:00.000Z',
  fait: false,
  origine: 'os',
  contact: { id: 'c1', nom: 'Romain Arpin' },
  entreprise: null,
  opportunite: null,
  ...extra,
});

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  if (method === 'POST' && url.endsWith('/prospection/campagnes')) {
    return Promise.resolve(
      refus
        ? new Response(JSON.stringify({ error: refus }), { status: 400 })
        : new Response(JSON.stringify({ campagneId: 'camp-1', refusees: [] }), { status: 201 }),
    );
  }
  return Promise.resolve(
    new Response(
      JSON.stringify({
        id: 'camp-1',
        mode: 'relance',
        statut: 'redaction',
        erreur: null,
        reglage: {},
        resultat: null,
        brouillons: [],
      }),
    ),
  );
}

const ouvrir = (t: TacheVue) =>
  render(
    <EditionTache tache={t} hubspot={false} slug="simatis" onSave={vi.fn()} onClose={vi.fn()} />,
  );

describe('Brouillon de relance depuis une tâche de mail', () => {
  beforeEach(() => {
    calls = [];
    refus = null;
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('propose le brouillon sur une tâche de mail ouverte avec un contact', () => {
    ouvrir(tache());
    expect(screen.getByLabelText('Contexte et style du brouillon')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Préparer un brouillon/ })).toBeTruthy();
  });

  it('ne le propose ni pour un appel, ni pour une tâche faite, ni sans contact', () => {
    for (const t of [
      tache({ type: 'appel', canal: 'appel', titre: 'Appeler Romain' }),
      tache({ fait: true }),
      tache({ contact: null }),
    ]) {
      ouvrir(t);
      expect(screen.queryByRole('button', { name: /Préparer un brouillon/ })).toBeNull();
      cleanup();
    }
  });

  it('crée une campagne d’une tâche avec le style saisi, puis attend Claude', async () => {
    ouvrir(tache());
    fireEvent.change(screen.getByLabelText('Contexte et style du brouillon'), {
      target: { value: '  Suite au rendez-vous de mardi, ton court  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Préparer un brouillon/ }));
    await screen.findByText('Claude rédige les brouillons…');
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/i/simatis/prospection/campagnes');
    expect(post?.body).toMatchObject({
      mode: 'relance',
      tacheIds: ['t1'],
      reglage: {
        signatureId: null,
        creneaux: false,
        style: 'Suite au rendez-vous de mardi, ton court',
      },
    });
    expect(post?.body).not.toHaveProperty('liens');
  });

  it('transmet les créneaux demandés', async () => {
    ouvrir(tache({ contact: { id: 'c1', nom: 'Romain Arpin' } }));
    fireEvent.click(screen.getByLabelText('Proposer 3 créneaux'));
    fireEvent.click(screen.getByRole('button', { name: /Préparer un brouillon/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      reglage: { creneaux: true },
    });
  });

  it('affiche la raison du refus du serveur', async () => {
    refus = "Romain Arpin n'a pas d'adresse mail.";
    ouvrir(tache());
    fireEvent.click(screen.getByRole('button', { name: /Préparer un brouillon/ }));
    expect((await screen.findByRole('alert')).textContent).toContain("n'a pas d'adresse mail");
  });
});
