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

  it('montre le résumé et le texte de la dernière session', async () => {
    monter();
    expect(await screen.findByText('Résumé fictif de la visio.')).toBeTruthy();
    expect(screen.getByText(/Bonjour à vous/)).toBeTruthy();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Utiliser comme compte rendu' }));
    expect(await screen.findByText(/Compte rendu enregistré/)).toBeTruthy();
    const envoi = calls.find((c) => c.url.endsWith('/rendez-vous/os%3Av1/compte-rendu'));
    expect(envoi?.body).toMatchObject({
      titre: 'V - Atelier Fictif x Simatis',
      texte: 'Résumé fictif de la visio.',
    });
  });

  it('modifie le résumé et le texte puis enregistre', async () => {
    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Résumé'), { target: { value: 'Résumé corrigé.' } });
    fireEvent.change(screen.getByLabelText('Texte'), { target: { value: 'Moi : Texte corrigé.' } });
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
