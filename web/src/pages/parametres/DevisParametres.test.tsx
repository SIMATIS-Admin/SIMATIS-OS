// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevisParametres } from './DevisParametres.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

const parametres = {
  reglages: {
    numerotation: 'DEV-{AAAA}-{NNN}',
    mentions: 'Société fictive',
    tvaPct: 20,
    validiteJours: 30,
    acomptePct: 0,
  },
  clauses: [{ id: 'c1', titre: 'Paiement', texte: 'À 30 jours.', parDefaut: true, ordre: 1 }],
  modeles: [],
};

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url.endsWith('/devis/parametres')) return json(parametres);
  return json({ id: 'x' });
}

describe('Paramètres du devis', () => {
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('montre les réglages, un exemple de numéro, et enregistre les changements', async () => {
    render(<DevisParametres slug="simatis" />);
    const format = await screen.findByLabelText<HTMLInputElement>('Format de numérotation');
    expect(format.value).toBe('DEV-{AAAA}-{NNN}');
    expect(screen.getByText(/Exemple : DEV-\d{4}-007/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('TVA (%)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les réglages' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      url: '/api/i/simatis/devis/parametres/reglages',
      body: { tvaPct: 10, mentions: 'Société fictive', numerotation: 'DEV-{AAAA}-{NNN}' },
    });
  });

  it('refuse un format sans compteur avant tout envoi', async () => {
    render(<DevisParametres slug="simatis" />);
    const format = await screen.findByLabelText('Format de numérotation');
    fireEvent.change(format, { target: { value: 'DEV-{AAAA}' } });
    expect(screen.getByText(/il faut un compteur/)).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Enregistrer les réglages' }).disabled,
    ).toBe(true);
  });

  it('ajoute une clause à la bibliothèque', async () => {
    render(<DevisParametres slug="simatis" />);
    expect(await screen.findByDisplayValue('Paiement')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Titre de la nouvelle clause'), {
      target: { value: 'Confidentialité' },
    });
    fireEvent.change(screen.getByLabelText('Texte de la nouvelle clause'), {
      target: { value: 'Informations gardées confidentielles.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la clause' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/i/simatis/devis/parametres/clauses',
      body: {
        titre: 'Confidentialité',
        texte: 'Informations gardées confidentielles.',
        parDefaut: false,
      },
    });
  });

  it('ajoute un modèle de mission sans aucun prix', async () => {
    render(<DevisParametres slug="simatis" />);
    await screen.findByDisplayValue('Paiement');
    fireEvent.change(screen.getByLabelText('Nom du nouveau modèle'), {
      target: { value: 'Modèle fictif' },
    });
    fireEvent.change(screen.getByLabelText('Périmètre inclus du nouveau modèle'), {
      target: { value: 'Une prestation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter le modèle' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/parametres/modeles'))).toBeTruthy(),
    );
    const corps = calls.find((c) => c.url.endsWith('/parametres/modeles'))?.body as {
      nom: string;
      inclus: string;
      lignes: Record<string, unknown>[];
    };
    expect(corps).toMatchObject({ nom: 'Modèle fictif', inclus: 'Une prestation' });
    expect(JSON.stringify(corps.lignes)).not.toMatch(/prix/i);
  });

  it('supprime une clause de la bibliothèque', async () => {
    render(<DevisParametres slug="simatis" />);
    await screen.findByDisplayValue('Paiement');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la clause Paiement' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe(
      '/api/i/simatis/devis/parametres/clauses/c1',
    );
  });
});
