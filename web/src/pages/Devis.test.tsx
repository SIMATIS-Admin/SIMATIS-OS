// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Devis } from './Devis.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

const contenu = {
  titre: 'Diagnostic fictif',
  contexte: 'Contexte fictif',
  objectifs: '',
  inclus: 'Entretiens',
  exclu: 'Recrutement',
  livrables: '',
  debut: null,
  duree: '',
  remisePct: 0,
  acomptePct: 0,
  frais: 'refactures',
  validiteJours: 30,
  clauses: [{ titre: 'Paiement', texte: 'À 30 jours', active: true }],
};
const brouillon = {
  ...contenu,
  id: 'd1',
  opportuniteId: 'o9',
  numero: 'DEV-2026-001',
  version: 1,
  statut: 'brouillon',
  createdAt: '2026-11-01T00:00:00Z',
  envoyeLe: null,
  opportunite: 'Diagnostic fictif',
  entreprise: 'Exemple Industrie',
  contact: 'Camille Exemple',
  lignes: [
    { libelle: 'Diagnostic', unite: 'forfait', quantite: 1, prixUnitaire: null, prixPropose: 5100 },
  ],
  totaux: { brut: 0, remise: 0, ht: 0, tva: 0, ttc: 0, acompte: 0, prixManquant: true },
  versions: 1,
};
const valide = {
  ...brouillon,
  statut: 'valide',
  lignes: [{ libelle: 'Diagnostic', unite: 'forfait', quantite: 1, prixUnitaire: 5100 }],
};
const etapes = [
  { id: 'detection', label: 'Détection' },
  { id: 'prospection', label: 'Prospection' },
  { id: 'qualification', label: 'Qualification' },
  { id: 'proposition', label: 'Proposition' },
];
const opps = [
  {
    id: 'radar-1',
    titre: 'Premier contact',
    etape: 'prospection',
    clos: null,
    entreprise: 'Radar SA',
    montant: null,
    modeFacturation: 'spot',
  },
  {
    id: 'o2',
    titre: 'Accompagnement',
    etape: 'qualification',
    clos: null,
    entreprise: 'Démo Mécanique',
    montant: 900,
    modeFacturation: 'recurrent',
  },
  {
    id: 'o1',
    titre: 'Diagnostic fictif',
    etape: 'proposition',
    clos: null,
    entreprise: 'Exemple Industrie',
    montant: 5100,
    modeFacturation: 'spot',
  },
];

let detail: Record<string, unknown> = brouillon;
let existant = false;

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url.endsWith('/pipeline')) return json({ etapes, opportunites: opps });
  if (url.endsWith('/devis') && method === 'GET') return json([detail]);
  if (url.endsWith('/devis') && method === 'POST') return json({ ...detail, existant });
  if (url.endsWith('/devis/d1') && method === 'GET') return json(detail);
  if (url.endsWith('/version')) return json({ ...brouillon, id: 'd2', version: 2 });
  return json({ id: 'd1', statut: 'proposee' });
}

describe('écran Devis', () => {
  beforeEach(() => {
    calls = [];
    detail = brouillon;
    existant = false;
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('la liste montre le numéro, le client et « prix à fixer »', async () => {
    render(<Devis slug="simatis" />);
    expect(await screen.findByText('DEV-2026-001')).toBeTruthy();
    expect(screen.getByText('Exemple Industrie')).toBeTruthy();
    expect(screen.getByText('prix à fixer')).toBeTruthy();
  });

  it('le choix de l’affaire filtre à la saisie et met la Proposition en tête', async () => {
    render(<Devis slug="simatis" />);
    fireEvent.click(await screen.findByText('+ Nouveau devis'));
    const lignes = await screen.findAllByRole('button', { name: /Préparer le devis/ });
    expect(lignes).toHaveLength(2);
    const premiere = screen.getAllByRole('row')[0] as HTMLElement;
    expect(premiere.textContent).toContain('Exemple Industrie');
    fireEvent.change(screen.getByPlaceholderText(/Rechercher une affaire/), {
      target: { value: 'démo' },
    });
    expect(screen.getAllByRole('button', { name: /Préparer le devis/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Préparer le devis/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ opportuniteId: 'o2' }),
    );
  });

  it('ne propose pas les affaires encore au Radar', async () => {
    render(<Devis slug="simatis" />);
    fireEvent.click(await screen.findByText('+ Nouveau devis'));
    await screen.findAllByRole('button', { name: /Préparer le devis/ });
    expect(screen.queryByText('Radar SA')).toBeNull();
    expect(screen.getByText('Proposition')).toBeTruthy();
  });

  it('saisir un prix met l’aperçu à jour sans réseau, puis enregistre le brouillon', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Prix/ }));
    const avant = calls.length;
    fireEvent.change(screen.getByLabelText('Prix unitaire : Diagnostic'), {
      target: { value: '1000' },
    });
    expect(screen.getAllByText(/1 200 €|1 200,00 €/).length).toBeGreaterThan(0);
    expect(calls.length).toBe(avant);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true), {
      timeout: 3000,
    });
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      lignes: [{ prixUnitaire: 1000 }],
    });
  });

  it('« Reprendre » copie le montant de l’affaire dans le prix', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Prix/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reprendre 5\s100/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Prix unitaire : Diagnostic').value).toBe(
      '5100',
    );
  });

  it('« Valider le devis » est grisé tant qu’un prix manque', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Envoi/ }));
    expect(screen.getByText<HTMLButtonElement>('Valider le devis').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Prix/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reprendre 5\s100/ }));
    fireEvent.click(screen.getByRole('button', { name: /Envoi/ }));
    expect(screen.getByText<HTMLButtonElement>('Valider le devis').disabled).toBe(false);
  });

  it('un devis validé a tous ses champs désactivés et propose une nouvelle version', async () => {
    detail = valide;
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Mission/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Intitulé de la mission').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Envoi/ }));
    fireEvent.click(screen.getByText('Nouvelle version'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/version'))).toBe(true));
  });

  it('avec une affaire, ouvre directement le devis existant', async () => {
    existant = true;
    render(<Devis slug="simatis" affaire="o1" />);
    expect(await screen.findByLabelText('Intitulé de la mission')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ opportuniteId: 'o1' });
  });

  it('« Tous les devis » ramène à la liste même après une ouverture depuis une affaire', async () => {
    render(<Devis slug="simatis" affaire="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Tous les devis/ }));
    expect(await screen.findByText('+ Nouveau devis')).toBeTruthy();
  });

  it('quitter l’éditeur tout de suite enregistre quand même la saisie', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Prix/ }));
    fireEvent.change(screen.getByLabelText('Prix unitaire : Diagnostic'), {
      target: { value: '1000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Tous les devis/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      lignes: [{ prixUnitaire: 1000 }],
    });
  });

  it('valider n’attend pas l’enregistrement automatique : un seul PUT avant la validation', async () => {
    render(<Devis slug="simatis" ouvrir="d1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Prix/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reprendre 5\s100/ }));
    fireEvent.click(screen.getByRole('button', { name: /Envoi/ }));
    fireEvent.click(screen.getByText('Valider le devis'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/valider'))).toBe(true));
    await new Promise((r) => setTimeout(r, 1200));
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });
});
