// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatsProspection, VueProspection } from '../api.js';
import { PanneauProspection, Prospection } from './Prospection.js';

const stats = (o: Partial<StatsProspection> = {}): StatsProspection => ({
  jour: 14,
  objectif: 30,
  semaine: 62,
  reponses: 9,
  rdv: 3,
  parTheme: { 'Test de VMA': 30, Diagnostic: 20, Kairos: 12 },
  parTouche: { '1': 40, '2': 15, '3': 7 },
  relancesFaites: 4,
  relancesRestantes: 6,
  aConfirmer: 0,
  ...o,
});

let reponse: () => Promise<Response>;
const avec = (s: StatsProspection): VueProspection => ({
  stats: s,
  signatures: [],
  recentes: [],
  enCours: null,
});
const repondre = (v: VueProspection) => () => Promise.resolve(new Response(JSON.stringify(v)));

beforeEach(() => {
  reponse = repondre(avec(stats()));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => reponse()),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const jauge = () => document.querySelector<HTMLElement>('[role="progressbar"]');

describe('Prospection', () => {
  it("affiche le compteur du jour sur l'objectif et la jauge", async () => {
    render(<Prospection slug="simatis" />);
    expect(await screen.findByText('14')).toBeTruthy();
    expect(screen.getByText(/sur 30/)).toBeTruthy();
    expect(jauge()?.getAttribute('aria-valuenow')).toBe('47');
  });

  it("plafonne la jauge à 100 % quand l'objectif est dépassé", async () => {
    reponse = repondre(avec(stats({ jour: 45, objectif: 30 })));
    render(<Prospection slug="simatis" />);
    await screen.findByText('45');
    expect(jauge()?.getAttribute('aria-valuenow')).toBe('100');
  });

  it("masque la jauge et le « sur » quand l'objectif est 0", async () => {
    reponse = repondre(avec(stats({ jour: 3, objectif: 0 })));
    render(<Prospection slug="simatis" />);
    await screen.findByText('3');
    expect(jauge()).toBeNull();
    expect(screen.queryByText(/sur 0/)).toBeNull();
  });

  it('affiche la semaine, les réponses, les thèmes et les touches', async () => {
    render(<Prospection slug="simatis" />);
    await screen.findByText(/62 envoyés/);
    expect(screen.getByText(/9 réponses/)).toBeTruthy();
    expect(screen.getByText(/3 rendez-vous/)).toBeTruthy();
    expect(screen.getByText(/Test de VMA/)).toBeTruthy();
    expect(screen.getByText(/Touche 2/)).toBeTruthy();
  });

  it('propose de relancer des tâches, et annonce la prospection à froid comme Bientôt', async () => {
    render(<Prospection slug="simatis" />);
    await screen.findByText('14');
    expect(
      screen.getByRole('button', { name: /Choisir les tâches/ }).hasAttribute('disabled'),
    ).toBe(false);
    expect(
      screen.getByRole('button', { name: /Tirer un échantillon/ }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getAllByText('Bientôt').length).toBe(1);
  });

  it('affiche des zéros sans erreur pour une instance vide', async () => {
    reponse = repondre(
      avec(stats({ jour: 0, semaine: 0, reponses: 0, rdv: 0, parTheme: {}, parTouche: {} })),
    );
    render(<Prospection slug="vide" />);
    expect(await screen.findByText(/0 envoyé/)).toBeTruthy();
    expect(screen.getByText(/Rien cette semaine/)).toBeTruthy();
  });

  it("affiche le message d'erreur si l'API échoue", async () => {
    reponse = () =>
      Promise.resolve(new Response(JSON.stringify({ error: 'Panne' }), { status: 500 }));
    render(<Prospection slug="simatis" />);
    expect(await screen.findByText(/Panne/)).toBeTruthy();
  });
});

describe('PanneauProspection (Brief du jour)', () => {
  it("affiche les mêmes chiffres que l'accueil et un lien vers la prospection", async () => {
    render(<PanneauProspection slug="simatis" />);
    expect(await screen.findByText('14')).toBeTruthy();
    expect(screen.getByText(/sur 30/)).toBeTruthy();
    expect(screen.getByText(/Relances faites aujourd'hui/)).toBeTruthy();
    const lien = screen.getByRole('link', { name: /Ouvrir/ });
    expect(lien.getAttribute('href')).toBe('#/simatis/prospection');
  });

  it("disparaît sans erreur quand l'API échoue", async () => {
    reponse = () => Promise.resolve(new Response('{}', { status: 500 }));
    const { container } = render(<PanneauProspection slug="simatis" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
