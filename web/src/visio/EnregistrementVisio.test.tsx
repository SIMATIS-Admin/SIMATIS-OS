// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnregistrementVisio } from './EnregistrementVisio.js';

type Call = { url: string; method: string; body?: unknown };
let calls: Call[] = [];
let derniere: object | null;
let courante: object;

const session = (extra: object) => ({
  id: 's1',
  statut: 'transcrit',
  debutAt: '2026-10-12T08:00:00.000Z',
  transcript: 'Moi : Bonjour.\nAutres : Bonjour à vous.',
  resume: 'Résumé fictif de la visio.',
  morceaux: 2,
  transcrits: 2,
  ...extra,
});

function fakeFetch(url: string, init?: { method?: string; body?: unknown }) {
  const method = init?.method ?? 'GET';
  calls.push({
    url,
    method,
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  });
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
  if (method === 'PATCH') {
    const corps = JSON.parse(String(init?.body)) as object;
    courante = { ...courante, ...corps };
    return json(courante);
  }
  if (url.endsWith('/rendez-vous/os%3Av1/session')) {
    return derniere ? json(derniere) : json({ error: 'Aucune session' }, 404);
  }
  if (method === 'POST' && url.endsWith('/rendez-vous')) return json({ id: 'os:nouveau' }, 201);
  if (method === 'GET' && url.endsWith('/rendez-vous')) {
    return json({
      etat: 'ok',
      rdv: [
        {
          id: 'os:v1',
          titre: 'V - Atelier Fictif x Simatis',
          debut: '2026-11-19T08:00:00Z',
          statut: 'rdv',
        },
        {
          id: 'os:autre',
          titre: 'Réunion avec Dupont fictif',
          debut: '2026-11-18T08:00:00Z',
          statut: 'rdv',
        },
      ],
    });
  }
  if (url.endsWith('/visio/sessions/s1')) return json(courante);
  return json({});
}

const monter = (extra: object = {}) =>
  render(
    <EnregistrementVisio
      slug="simatis"
      rdvId="os:v1"
      titre="V - Atelier Fictif x Simatis"
      intervalleMs={10}
      {...extra}
    />,
  );

describe('EnregistrementVisio', () => {
  beforeEach(() => {
    calls = [];
    derniere = session({});
    courante = session({});
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('n’offre aucun bouton d’enregistrement : l’appli Mac enregistre', async () => {
    monter();
    await screen.findByText('Résumé fictif de la visio.');
    expect(screen.queryByRole('button', { name: /Enregistrer$/ })).toBeNull();
  });

  it('montre le résumé, puis le transcript dans un second onglet en tuile', async () => {
    monter();
    expect(await screen.findByText('Résumé fictif de la visio.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Résumé' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByText(/Bonjour à vous/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.getByText(/Bonjour à vous/)).toBeTruthy();
    expect(screen.queryByText('Résumé fictif de la visio.')).toBeNull();
  });

  it('dit qu’il n’y a rien quand le rendez-vous n’a aucun enregistrement', async () => {
    derniere = null;
    monter();
    expect(await screen.findByText(/Aucun enregistrement/)).toBeTruthy();
  });

  it('affiche le texte en direct pendant l’enregistrement', async () => {
    derniere = session({ statut: 'en_cours', resume: null, transcript: 'Moi : En direct.' });
    courante = derniere;
    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Transcript' }));
    expect(await screen.findByText(/En direct\./)).toBeTruthy();
    expect(screen.getByText(/Enregistrement en cours/)).toBeTruthy();
  });

  it('attend le résumé qui arrive après la transcription', async () => {
    derniere = session({ resume: null });
    courante = session({ resume: 'Résumé tardif.' });
    monter();
    expect(await screen.findByText(/Résumé en préparation/)).toBeTruthy();
    expect(await screen.findByText('Résumé tardif.')).toBeTruthy();
  });

  it('en fait le compte rendu du rendez-vous sur demande', async () => {
    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer comme compte rendu' }));
    expect(await screen.findByText(/Compte rendu enregistré/)).toBeTruthy();
    const envoi = calls.find((c) => c.url.endsWith('/rendez-vous/os%3Av1/compte-rendu'));
    expect(envoi?.body).toMatchObject({
      titre: 'V - Atelier Fictif x Simatis',
      texte: 'Résumé fictif de la visio.',
    });
  });

  it('garde le transcript dans le rendez-vous sur demande', async () => {
    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Transcript' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Enregistrer le transcript dans le rendez-vous' }),
    );
    expect(await screen.findByText(/Transcript enregistré dans le rendez-vous/)).toBeTruthy();
    expect(
      calls.some((c) => c.method === 'POST' && c.url.endsWith('/visio/sessions/s1/transcript-rdv')),
    ).toBe(true);
  });

  it('rattache l’enregistrement à un rendez-vous existant', async () => {
    const onRattache = vi.fn();
    monter({ onRattache });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Rattacher à un autre rendez-vous' }),
    );
    const liste = await screen.findByLabelText('Rendez-vous existant');
    await screen.findByRole('option', { name: /Réunion avec Dupont fictif/ });
    expect(screen.queryByRole('option', { name: /V - Atelier Fictif/ })).toBeNull();
    fireEvent.change(liste, { target: { value: 'os:autre' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rattacher' }));
    await waitFor(() => expect(onRattache).toHaveBeenCalledWith('os:autre'));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ rdvId: 'os:autre' });
  });

  it('crée un rendez-vous sur place puis y rattache l’enregistrement', async () => {
    const onRattache = vi.fn();
    monter({ onRattache });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Rattacher à un autre rendez-vous' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Créer un rendez-vous' }));
    fireEvent.change(screen.getByLabelText('Titre du rendez-vous'), {
      target: { value: 'Contrat Fictif' },
    });
    fireEvent.change(screen.getByLabelText('Date et heure'), {
      target: { value: '2026-11-19T14:27' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer et rattacher' }));
    await waitFor(() => expect(onRattache).toHaveBeenCalledWith('os:nouveau'));
    const creation = calls.find((c) => c.method === 'POST' && c.url.endsWith('/rendez-vous'));
    expect(creation?.body).toMatchObject({ titre: 'Contrat Fictif', dureeMinutes: 60 });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ rdvId: 'os:nouveau' });
  });

  it('modifie le résumé et le texte puis enregistre', async () => {
    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Résumé'), { target: { value: 'Résumé corrigé.' } });
    fireEvent.change(screen.getByLabelText('Transcript'), {
      target: { value: 'Moi : Texte corrigé.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    expect(await screen.findByText('Résumé corrigé.')).toBeTruthy();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ resume: 'Résumé corrigé.', transcript: 'Moi : Texte corrigé.' });
  });

  it('supprime l’enregistrement après confirmation et prévient l’écran', async () => {
    const onSupprime = vi.fn();
    monter({ onSupprime });
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(onSupprime).toHaveBeenCalledOnce());
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/visio/sessions/s1'))).toBe(
      true,
    );
  });

  it('ne supprime rien si Marc annule', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});
