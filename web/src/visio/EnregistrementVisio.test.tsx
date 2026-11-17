// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnregistrementVisio } from './EnregistrementVisio.js';

type Call = { url: string; method: string; body?: unknown };
let calls: Call[] = [];
let ordre: string[] = [];
let derniere: object | null;
let apresFin: object;

class FauxRecorder {
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = 'audio/webm';
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob(['son']) });
    this.onstop?.();
  }
}
class FauxFlux {
  constructor(public pistes: unknown[] = []) {}
  getTracks() {
    return this.pistes;
  }
  getAudioTracks() {
    return this.pistes;
  }
}

function fakeFetch(url: string, init?: { method?: string; body?: unknown }) {
  const method = init?.method ?? 'GET';
  calls.push({
    url,
    method,
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  });
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (url.endsWith('/visio/sessions') && method === 'POST') return json({ id: 's1' }, 201);
  if (url.endsWith('/fin')) return json({ statut: 'clos' });
  if (url.endsWith('/rendez-vous/os%3Av1/session')) {
    return derniere ? json(derniere) : json({ error: 'Aucune session' }, 404);
  }
  if (url.endsWith('/visio/sessions/s1')) return json(apresFin);
  return json({});
}

const session = (extra: object) => ({
  id: 's1',
  statut: 'transcrit',
  debutAt: '2026-10-12T08:00:00.000Z',
  transcript: null,
  morceaux: 2,
  transcrits: 2,
  ...extra,
});

describe('EnregistrementVisio', () => {
  let affichage: 'ok' | 'refus' | 'sans-son';
  beforeEach(() => {
    calls = [];
    ordre = [];
    derniere = null;
    affichage = 'ok';
    apresFin = session({ transcript: 'Moi : Bonjour.\nAutres : Bonjour à vous.' });
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    vi.stubGlobal('MediaRecorder', FauxRecorder);
    vi.stubGlobal('MediaStream', FauxFlux);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(() => {
          ordre.push('micro');
          return Promise.resolve(new FauxFlux([{ stop: vi.fn() }]));
        }),
        getDisplayMedia: vi.fn(() => {
          ordre.push('onglet');
          if (affichage === 'refus') return Promise.reject(new Error('refusé'));
          return Promise.resolve(new FauxFlux(affichage === 'ok' ? [{ stop: vi.fn() }] : []));
        }),
      },
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const monter = () =>
    render(<EnregistrementVisio slug="simatis" rdvId="os:v1" intervalleMs={10} />);

  it('ne demande aucun accès avant le clic de l’utilisateur', async () => {
    monter();
    await screen.findByRole('button', { name: 'Enregistrer' });
    expect(ordre).toEqual([]);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('demande le micro puis l’onglet au clic, et ouvre la session', async () => {
    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
    await screen.findByRole('button', { name: 'Arrêter' });
    expect(ordre).toEqual(['micro', 'onglet']);
    expect(calls.some((c) => c.url.endsWith('/visio/sessions') && c.method === 'POST')).toBe(true);
    expect(screen.getByText(/Prévenez les participants/)).toBeTruthy();
  });

  it('dit « micro seul » quand le son de l’onglet est refusé ou absent', async () => {
    affichage = 'refus';
    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/micro seul/i)).toBeTruthy();
    cleanup();
    affichage = 'sans-son';
    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/micro seul/i)).toBeTruthy();
  });

  it('clôt la session à l’arrêt puis affiche le transcript', async () => {
    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Arrêter' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/s1/fin'))).toBe(true));
    expect(await screen.findByText(/Bonjour à vous/)).toBeTruthy();
  });

  it('affiche le texte en direct pendant l’enregistrement', async () => {
    apresFin = session({ statut: 'en_cours', transcript: 'Moi : En direct.', transcrits: 1 });
    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/En direct\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arrêter' })).toBeTruthy();
  });

  it('montre le résumé et en fait le compte rendu du rendez-vous sur demande', async () => {
    derniere = session({ transcript: 'Moi : Texte.', resume: 'Résumé fictif de la visio.' });
    render(
      <EnregistrementVisio
        slug="simatis"
        rdvId="os:v1"
        titre="V - Atelier Fictif x Simatis"
        intervalleMs={10}
      />,
    );
    expect(await screen.findByText('Résumé fictif de la visio.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser comme compte rendu' }));
    expect(await screen.findByText(/Compte rendu enregistré/)).toBeTruthy();
    const envoi = calls.find((c) => c.url.endsWith('/rendez-vous/os%3Av1/compte-rendu'));
    expect(envoi?.body).toMatchObject({
      titre: 'V - Atelier Fictif x Simatis',
      texte: 'Résumé fictif de la visio.',
    });
  });

  it('attend le résumé qui arrive après la transcription', async () => {
    derniere = session({ transcript: 'Moi : Texte.', resume: null });
    apresFin = session({ transcript: 'Moi : Texte.', resume: 'Résumé tardif.' });
    monter();
    expect(await screen.findByText(/Résumé en préparation/)).toBeTruthy();
    expect(await screen.findByText('Résumé tardif.')).toBeTruthy();
  });

  it('retrouve le transcript d’une session passée au chargement', async () => {
    derniere = session({ transcript: 'Moi : Déjà là.' });
    monter();
    expect(await screen.findByText(/Déjà là/)).toBeTruthy();
  });
});
