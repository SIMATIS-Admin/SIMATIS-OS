// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gestion } from './Gestion.js';

const occurrence = {
  depenseId: '11111111-1111-4111-8111-111111111111',
  cle: '11111111-1111-4111-8111-111111111111|2026-11-10',
  libelle: 'Abonnement fictif',
  categorie: 'Outils et abonnements',
  date: '2026-11-10',
  montantTtcCents: 12_000,
  etat: 'a_venir',
  statut: 'prevue',
  recurrente: true,
  payeur: 'societe',
  affectations: [{ cible: 'mandat', mandat: 'mandat-test' }],
  refacturable: true,
  justificatif: null,
};
const synthese = {
  mois: '2026-11',
  payeCents: 0,
  aVenirCents: 12_000,
  totalCents: 12_000,
  parMois12: [{ mois: '2026-11', cents: 12_000 }],
  recurrentMensuelCents: 12_000,
};
const mandats = [{ slug: 'mandat-test', nom: 'Mandat test' }];
let envois: { url: string; method: string; corps: unknown }[] = [];

describe('Gestion', () => {
  beforeEach(() => {
    envois = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method !== 'GET') envois.push({ url, method, corps: JSON.parse(init?.body as string) });
        const corps = url.includes('gestion/depenses?')
          ? { synthese, occurrences: [occurrence] }
          : { id: occurrence.depenseId };
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(corps) });
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('refuse l’affichage hors de Mon activité', () => {
    render(<Gestion slug="x" autorise={false} mandats={[]} />);
    expect(screen.getByText(/pas disponible/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('affiche le mois, le récurrent mensuel et laisse les autres sources « non renseigné »', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    await waitFor(() => expect(screen.getAllByText(/12\s000|120/).length).toBeGreaterThan(0));
    expect(screen.getAllByText('Non renseigné')).toHaveLength(3);
    expect(screen.getByText('Charges récurrentes / mois')).toBeTruthy();
  });

  it('crée une dépense en trois champs, montant en centimes entiers', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Dépense' }));
    fireEvent.change(screen.getByPlaceholderText(/abonnement, repas/), {
      target: { value: 'Téléphone fictif' },
    });
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '35,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mensuelle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]).toMatchObject({
      url: '/api/i/simatis/gestion/depenses',
      method: 'POST',
      corps: {
        libelle: 'Téléphone fictif',
        montantTtcCents: 3550,
        recurrence: 'mensuelle',
        dateDebut: '2026-11-12',
        statut: 'reelle',
        affectations: [{ cible: 'simatis' }],
      },
    });
  });

  it('refuse un montant vide sans appeler le serveur', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Dépense' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(envois).toHaveLength(0);
  });

  it('distingue refacturable d’une recette : badge, jamais de montant refacturé', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Dépenses' }));
    expect(await screen.findByText('Abonnement fictif')).toBeTruthy();
    expect(screen.getByText('Refacturable', { selector: '.badge' })).toBeTruthy();
    expect(screen.getByText('Mandat test', { selector: '.badge' })).toBeTruthy();
  });
});
