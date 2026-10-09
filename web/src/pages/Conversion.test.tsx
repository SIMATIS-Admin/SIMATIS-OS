// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Devis } from './Devis.js';
import { RendezVous } from './RendezVous.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

const devis = {
  id: 'd1',
  numero: 'DEV-2026-001',
  statut: 'brouillon',
  lignes: [
    { libelle: 'Diagnostic', quantite: 1, prixUnitaire: 4500 },
    { libelle: 'Restitution et plan de suivi', quantite: 1, prixUnitaire: null },
  ],
  envoyeLe: null,
  validite: null,
  opportunite: 'Diagnostic commercial',
  entreprise: 'Fonderie Vallière',
  total: 4500,
  prixManquant: true,
};
const rdv = {
  etat: 'ok',
  rdv: [
    {
      id: 'evt-1',
      debut: '2026-10-01T08:00:00Z',
      fin: '2026-10-01T09:00:00Z',
      titre: 'Point projet',
      lieu: 'Rumilly',
      contact: { id: 'c1', nom: 'Hélène Morvan', entreprise: 'Ateliers Morvan' },
      opportunite: { id: 'o1', titre: 'Audit des utilités' },
      compteRendu: false,
    },
  ],
};

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url.endsWith('/pipeline')) return json({ opportunites: [] });
  if (url.endsWith('/devis')) return json([devis]);
  if (url.endsWith('/rendez-vous')) return json(rdv);
  if (url.endsWith('/preparation'))
    return json({
      titre: 'Audit des utilités',
      entreprise: 'Ateliers Morvan',
      score: 9,
      aCreuser: [{ critere: 'Budget', note: 1, question: null }],
    });
  return json({ id: 'x', statut: 'proposee' });
}

describe('conversion screens', () => {
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('devis: cannot validate while a price is missing, saves a price', async () => {
    render(<Devis slug="simatis" />);
    fireEvent.click(await screen.findByText('DEV-2026-001'));
    expect(screen.getByText<HTMLButtonElement>('Valider le devis').disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Prix unitaire : Restitution et plan de suivi'), {
      target: { value: '1500' },
    });
    expect(screen.getByText<HTMLButtonElement>('Valider le devis').disabled).toBe(false);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      lignes: [{ prixUnitaire: 4500 }, { prixUnitaire: 1500 }],
    });
  });

  it('rendez-vous: shows what to dig into, and sends a compte rendu', async () => {
    render(<RendezVous slug="helioval" />);
    fireEvent.click(await screen.findByText('Préparer'));
    expect(await screen.findByText('Budget')).toBeTruthy();
    fireEvent.click(screen.getByText('Compte rendu'));
    fireEvent.change(screen.getByPlaceholderText(/Besoin, interlocuteurs/), {
      target: { value: 'Besoin confirmé.' },
    });
    fireEvent.click(screen.getByText('Enregistrer le compte rendu'));
    expect(await screen.findByText(/attend dans À valider/)).toBeTruthy();
    expect(calls.find((c) => c.url.endsWith('/compte-rendu'))?.body).toMatchObject({
      titre: 'Point projet',
      texte: 'Besoin confirmé.',
      opportuniteId: 'o1',
    });
  });
});
