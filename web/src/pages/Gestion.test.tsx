// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AffairePipe } from '../api.js';
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
const projection = {
  aujourdhui: '2026-11-12',
  granularite: 'mois',
  reglages: {
    soldeCents: null,
    soldeDate: null,
    soldeSource: null,
    seuilMode: 'aucun',
    seuilCents: null,
    delaiPaiementJours: null,
  },
  seuil: { mode: 'aucun', cents: null, bfr: null },
  scenarios: ['securise', 'central', 'ambitieux'].map((scenario) => ({
    scenario,
    alerte: null,
    periodes: [
      {
        debut: '2026-11-01',
        fin: '2026-11-30',
        entreesCents: 0,
        sortiesCents: 12_000,
        soldeFinCents: null,
        variationCumuleeCents: -12_000,
        mouvements: [
          {
            date: '2026-11-20',
            sens: 'sortie',
            libelle: 'Abonnement fictif',
            montantCents: 12_000,
            nature: 'depense',
            ref: 'x',
            estime: true,
            note: null,
          },
        ],
      },
    ],
  })),
  pipe: { affaires: [] as AffairePipe[], decalageMois: 0 },
  avertissements: ["Solde d'ouverture non renseigné : seules les variations sont affichées."],
};
const AFFAIRE_PIPE: AffairePipe = {
  id: '22222222-2222-4222-8222-222222222222',
  titre: 'Affaire pipe fictive',
  entreprise: null,
  probabilite: 60,
  totalCents: 1_000_000,
  recurrent: false,
  mensuelCents: null,
  dureeMois: 12,
  signature: '2027-01-15',
  statut: 'comptee',
};
const suiviTva = {
  mois: '2026-11',
  declaration: 'mensuelle',
  exigibilite: 'a_confirmer',
  collecteeCents: 20_000,
  deductibleCents: 2_000,
  estimeeCents: 18_000,
  lignesSansTva: { recettes: 0, depenses: 0 },
  recettesIncertainesExclues: 0,
  declaree: null,
  avertissements: [
    "Exigibilité à confirmer avec le comptable : l'estimation retient la date de facture.",
  ],
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
          : url.includes('gestion/revenus?')
            ? {
                synthese: {
                  mois: '2026-11',
                  aEncaisserCertainCents: 600_000,
                  aEncaisserIncertainCents: 0,
                  encaisseCents: 0,
                  parMandat: [],
                },
                revenus: [],
              }
            : url.includes('factures-a-emettre')
              ? []
              : url.includes('gestion/tresorerie')
                ? projection
                : url.includes('gestion/tva')
                  ? suiviTva
                  : { id: occurrence.depenseId, refacturations: [] };
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
    expect(screen.getAllByText('Non renseigné')).toHaveLength(1);
    expect(screen.getByText('À confirmer')).toBeTruthy();
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
    fireEvent.click(await screen.findByRole('tab', { name: 'Mouvements' }));
    expect(await screen.findByText('Abonnement fictif')).toBeTruthy();
    expect(screen.getByText('Refacturable', { selector: '.badge' })).toBeTruthy();
    expect(screen.getByText('Mandat test', { selector: '.badge' })).toBeTruthy();
  });

  it('ajoute une recette unique pour un mandat, en HT et en centimes entiers', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Recette' }));
    fireEvent.change(screen.getByPlaceholderText(/commission sur contrat/), {
      target: { value: 'Commission fictive' },
    });
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '6 000' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mandat-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]).toMatchObject({
      url: '/api/i/simatis/gestion/revenus',
      method: 'POST',
      corps: {
        libelle: 'Commission fictive',
        montantHtCents: 600_000,
        mandat: 'mandat-test',
        type: 'commission',
        etat: 'prevue',
        dateEncaissement: null,
        recurrence: 'aucune',
        certitude: 'certaine',
      },
    });
  });

  it('crée une refacturation distincte par mandat depuis la dépense, sans réduire celle-ci', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Dépense' }));
    fireEvent.change(screen.getByPlaceholderText(/abonnement, repas/), {
      target: { value: 'Outil fictif' },
    });
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mensuelle' }));
    fireEvent.click(screen.getByLabelText(/Refacturable à un client/));
    fireEvent.change(screen.getByLabelText('Montant HT refacturable à Mandat test'), {
      target: { value: '50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(envois).toHaveLength(2));
    expect(envois[0]).toMatchObject({
      url: '/api/i/simatis/gestion/depenses',
      corps: { montantTtcCents: 12_000, refacturable: true },
    });
    expect(envois[1]).toMatchObject({
      url: '/api/i/simatis/gestion/revenus',
      corps: {
        type: 'refacturation',
        mandat: 'mandat-test',
        montantHtCents: 5_000,
        recurrence: 'mensuelle',
        depenseId: occurrence.depenseId,
      },
    });
  });

  it('affiche la projection sans solde inventé et rend ses mouvements explicables', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    expect(await screen.findByText(/Solde d'ouverture non renseigné/)).toBeTruthy();
    expect(screen.getByText(/Variation cumulée depuis aujourd’hui/)).toBeTruthy();
    fireEvent.click(document.querySelector('svg.g-svg rect')!);
    expect(await screen.findByText('Abonnement fictif')).toBeTruthy();
    expect(screen.getByText('Estimé')).toBeTruthy();
  });

  it('enregistre un seuil que Marc fixe, sans valeur par défaut', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Montant que je fixe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(envois).toHaveLength(0);
    const champs = screen.getAllByRole('textbox');
    const seuil = champs.find(
      (c) =>
        (c as HTMLInputElement).inputMode === 'decimal' && !(c as HTMLInputElement).placeholder,
    );
    fireEvent.change(seuil!, { target: { value: '6 000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]).toMatchObject({
      url: '/api/i/simatis/gestion/reglages',
      method: 'PUT',
      corps: { seuilMode: 'montant', seuilCents: 600_000, soldeCents: null },
    });
  });

  it('saisit la TVA déclarée à la main, avec l’exigibilité à confirmer', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'TVA & IK' }));
    expect(await screen.findByText(/exigibilité à confirmer/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Non renseigné'), { target: { value: '175' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]).toMatchObject({
      url: '/api/i/simatis/gestion/tva/2026-11',
      method: 'PUT',
      corps: { declareeCents: 17_500 },
    });
  });

  it('propose exactement trois onglets', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    const noms = (await screen.findAllByRole('tab')).map((t) => t.textContent);
    expect(noms).toEqual(['Pilotage', 'Mouvements', 'TVA & IK']);
  });

  it('« Voir les recettes » ouvre Mouvements filtré sur les recettes', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    fireEvent.click(await screen.findByRole('link', { name: 'Voir les recettes' }));
    expect(screen.getByRole('tab', { name: 'Mouvements' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Recettes' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('TVA & IK : un sélecteur bascule entre TVA et IK sans quitter l’onglet', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'TVA & IK' }));
    expect(await screen.findByText(/exigibilité à confirmer/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'IK & compte associé' }));
    expect(screen.queryByText(/exigibilité à confirmer/)).toBeNull();
    expect(screen.getByRole('tab', { name: 'TVA & IK' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('quitter Mouvements remet le filtre à Tout', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    fireEvent.click(await screen.findByRole('link', { name: 'Voir les recettes' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Pilotage' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Mouvements' }));
    expect(screen.getByRole('button', { name: 'Tout' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('Mouvements garde le montant à encaisser incertain', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Mouvements' }));
    expect(await screen.findByText('À encaisser, incertain (recettes HT)')).toBeTruthy();
  });

  it('affiche le verdict en tête de Pilotage', async () => {
    render(<Gestion slug="simatis" autorise mandats={mandats} />);
    expect(await screen.findByText('Impossible de dire si la trésorerie tient.')).toBeTruthy();
  });

  it('modifier la date d’une affaire l’envoie à la fiche, sans toucher à HubSpot', async () => {
    projection.pipe = { decalageMois: 0, affaires: [AFFAIRE_PIPE] };
    try {
      render(<Gestion slug="simatis" autorise mandats={mandats} />);
      fireEvent.change(await screen.findByLabelText('Signature estimée Affaire pipe fictive'), {
        target: { value: '2027-02-01' },
      });
      await waitFor(() => expect(envois).toHaveLength(1));
      expect(envois[0]).toMatchObject({
        url: '/api/i/simatis/fiches/affaire/22222222-2222-4222-8222-222222222222',
        method: 'PATCH',
        corps: { signatureEstimee: '2027-02-01' },
      });
    } finally {
      projection.pipe = { affaires: [], decalageMois: 0 };
    }
  });

  it('le curseur de signature relance la projection avec le décalage', async () => {
    projection.pipe = { decalageMois: 0, affaires: [AFFAIRE_PIPE] };
    try {
      render(<Gestion slug="simatis" autorise mandats={mandats} />);
      fireEvent.change(await screen.findByLabelText('Décalage des signatures (mois)'), {
        target: { value: '3' },
      });
      await waitFor(() =>
        expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('decalage=3'))).toBe(
          true,
        ),
      );
    } finally {
      projection.pipe = { affaires: [], decalageMois: 0 };
    }
  });
});
