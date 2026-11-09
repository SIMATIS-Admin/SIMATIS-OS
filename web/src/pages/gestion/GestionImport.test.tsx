// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyseImport } from '../../api.js';
import { GestionImport } from './GestionImport.js';

const ligne = (p: Partial<AnalyseImport['lignes'][number]> & { cle: string }) => ({
  rang: 1,
  date: '2026-10-15',
  libelle: 'Libellé fictif',
  montantCents: -2399,
  compte: 'Compte fictif',
  sens: 'sortie' as const,
  issue: 'nouvelle' as const,
  raison: null,
  rapprochement: null,
  ...p,
});
const analyse: AnalyseImport = {
  lignes: [
    ligne({ cle: 'n', libelle: 'Paiement fictif' }),
    ligne({ cle: 'd', libelle: 'Déjà vu fictif', issue: 'deja', raison: 'Déjà importée' }),
    ligne({
      cle: 'v',
      libelle: 'PRLV fictif',
      montantCents: -4900,
      issue: 'a_verifier',
      raison: 'Ressemble à « Abonnement fictif » prévu le 2026-10-14',
      rapprochement: {
        dejaCompte: false,
        type: 'depense',
        id: 'd1',
        recurrente: true,
        dateOrigine: '2026-10-14',
        libelle: 'Abonnement fictif',
        date: '2026-10-14',
        montantCents: 4900,
      },
    }),
    ligne({
      cle: 'e',
      libelle: 'VIR fictif',
      montantCents: 20_000,
      sens: 'entree',
      issue: 'a_verifier',
      raison: 'Aucune recette prévue ne correspond : à préciser',
    }),
  ],
  compteurs: { nouvelles: 1, deja: 1, aVerifier: 2, nonFinalisees: 0 },
  avertissements: [],
};

let appels: { url: string; corps: Record<string, unknown> }[] = [];
let reponses: Record<string, { ok: boolean; corps: unknown }>;

beforeEach(() => {
  appels = [];
  reponses = {
    analyse: { ok: true, corps: analyse },
    valider: { ok: true, corps: { importees: 2, rapprochees: 1, ignorees: 0 } },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      appels.push({ url, corps: JSON.parse(init?.body as string) as Record<string, unknown> });
      const r = reponses[url.endsWith('/valider') ? 'valider' : 'analyse']!;
      return Promise.resolve({
        ok: r.ok,
        status: r.ok ? 200 : 400,
        json: () => Promise.resolve(r.corps),
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CSV = 'Date;Libellé;Montant\n2026-10-15;Paiement fictif;-23,99';
async function choisir() {
  const surImporte = vi.fn();
  render(<GestionImport slug="simatis" onImporte={surImporte} />);
  const champ = screen.getByLabelText('Fichier Pennylane');
  fireEvent.change(champ, {
    target: { files: [new File([CSV], 'transactions.csv', { type: 'text/csv' })] },
  });
  await screen.findByTestId('c-nouvelles');
  return surImporte;
}

describe('GestionImport', () => {
  it('rappelle où trouver l’export dans Pennylane', () => {
    render(<GestionImport slug="simatis" onImporte={() => {}} />);
    expect(screen.getByText(/Gestion › Transactions/)).toBeTruthy();
    expect(screen.getByText(/Plus › Exports/)).toBeTruthy();
  });

  it('envoie le fichier en base64 à l’analyse et affiche les compteurs', async () => {
    await choisir();
    expect(appels[0]!.url).toBe('/api/i/simatis/gestion/import/analyse');
    expect(appels[0]!.corps.nomFichier).toBe('transactions.csv');
    const octets = Uint8Array.from(atob(appels[0]!.corps.contenuBase64 as string), (c) =>
      c.charCodeAt(0),
    );
    expect(new TextDecoder().decode(octets)).toBe(CSV);
    expect(screen.getByTestId('c-nouvelles').textContent).toBe('1');
    expect(screen.getByTestId('c-deja').textContent).toBe('1');
    expect(screen.getByTestId('c-averifier').textContent).toBe('2');
  });

  it('propose le rapprochement par défaut et laisse choisir', async () => {
    await choisir();
    const choix = screen.getByLabelText<HTMLSelectElement>('Décision pour PRLV fictif');
    expect(choix.value).toBe('rapprocher');
    expect(within(choix).getByText(/Rapprocher avec « Abonnement fictif »/)).toBeTruthy();
    fireEvent.change(choix, { target: { value: 'ignorer' } });
    expect(choix.value).toBe('ignorer');
  });

  it('une entrée sans recette prévue ne propose pas de rapprochement', async () => {
    await choisir();
    const choix = screen.getByLabelText('Décision pour VIR fictif');
    expect(within(choix).queryByText(/Rapprocher/)).toBeNull();
    expect(screen.getByText(/Aucune recette prévue ne correspond/)).toBeTruthy();
  });

  it('une entrée sans correspondance attend le choix de Marc : ni importée ni comptée', async () => {
    await choisir();
    const choix = screen.getByLabelText<HTMLSelectElement>('Décision pour VIR fictif');
    expect(choix.value).toBe('');
    expect(screen.getByRole('button', { name: 'Importer 2 lignes' })).toBeTruthy();
    fireEvent.change(choix, { target: { value: 'importer' } });
    expect(screen.getByRole('button', { name: 'Importer 3 lignes' })).toBeTruthy();
  });

  it('le bouton compte les lignes retenues et envoie les décisions choisies', async () => {
    const surImporte = await choisir();
    fireEvent.change(screen.getByLabelText('Décision pour VIR fictif'), {
      target: { value: 'ignorer' },
    });
    expect(screen.getByRole('button', { name: 'Importer 2 lignes' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Importer 2 lignes' }));
    await screen.findByText(/2 nouvelles, 1 rapprochée/);
    const v = appels.find((a) => a.url.endsWith('/valider'))!;
    expect(v.corps.decisions).toEqual({
      n: 'importer',
      v: 'rapprocher',
      e: 'ignorer',
    });
    expect(surImporte).toHaveBeenCalled();
    expect(screen.getByText(/mettez à jour le solde/i)).toBeTruthy();
  });

  it('une erreur du serveur s’affiche sans quitter l’écran de choix', async () => {
    reponses.analyse = { ok: false, corps: { error: 'Colonne obligatoire absente : Montant.' } };
    render(<GestionImport slug="simatis" onImporte={() => {}} />);
    fireEvent.change(screen.getByLabelText('Fichier Pennylane'), {
      target: { files: [new File(['x'], 'x.csv')] },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('Montant');
    expect(screen.getByLabelText('Fichier Pennylane')).toBeTruthy();
  });

  it('on peut recommencer avec un autre fichier', async () => {
    await choisir();
    fireEvent.click(screen.getByRole('button', { name: 'Choisir un autre fichier' }));
    await waitFor(() => expect(screen.getByLabelText('Fichier Pennylane')).toBeTruthy());
  });
});
