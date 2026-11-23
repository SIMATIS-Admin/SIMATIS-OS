// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReglagesSalesnav } from '../../api.js';

const api = vi.hoisted(() => ({
  fetchReglagesSalesnav: vi.fn(),
  enregistrerReglagesSalesnav: vi.fn(),
  patchFiche: vi.fn(),
}));
vi.mock('../../api.js', () => api);
vi.mock('../SalesnavMessages.js', () => ({
  SalesnavMessages: () => <div>Messages fictifs</div>,
}));

import { SalesnavRadar, type AffaireSalesnav } from './SalesnavRadar.js';

const reglages = (quotaJour = 8, pause = false): ReglagesSalesnav => ({
  quotaJour,
  quotaSemaine: quotaJour * 5,
  pause,
  quotaMax: 25,
  recommande: 8,
  cible: 12,
  niveau: 'normal',
});
const affaire = (id: string, etape: number): AffaireSalesnav => ({
  id,
  titre: `Affaire ${id}`,
  entreprise: `Entreprise ${id}`,
  contact: `Contact ${id}`,
  etape,
  lien: `#/demo/fiche/affaire/${id}`,
});

describe('SalesnavRadar', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  const monter = async (affaires: AffaireSalesnav[] = [], r = reglages()) => {
    api.fetchReglagesSalesnav.mockResolvedValue(r);
    const onChange = vi.fn();
    const onRetour = vi.fn();
    render(
      <SalesnavRadar slug="demo" affaires={affaires} onRetour={onRetour} onChange={onChange} />,
    );
    await screen.findByText('8 par jour · 40 par semaine').catch(() => undefined);
    return { onChange, onRetour };
  };

  it('affiche le quota enregistré et la valeur recommandée', async () => {
    await monter([], reglages(12));
    expect(await screen.findByText('12 par jour · 60 par semaine')).toBeTruthy();
    expect(screen.getByText(/Recommandé au départ : 8 par jour, puis 12/)).toBeTruthy();
  });

  it('enregistre le quota choisi avec le curseur', async () => {
    await monter();
    api.enregistrerReglagesSalesnav.mockResolvedValue(reglages(10));
    const curseur = await screen.findByLabelText('Demandes par jour');
    fireEvent.change(curseur, { target: { value: '10' } });
    expect(screen.getByText('10 par jour · 50 par semaine')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le quota' }));
    await waitFor(() =>
      expect(api.enregistrerReglagesSalesnav).toHaveBeenCalledWith('demo', { quotaJour: 10 }),
    );
  });

  it('avertit au-delà de 15 par jour et plus fort au-delà de 20', async () => {
    await monter();
    const curseur = await screen.findByLabelText('Demandes par jour');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(curseur, { target: { value: '16' } });
    expect(screen.getByRole('alert').textContent).toMatch(/Au-delà de 15 demandes/);
    fireEvent.change(curseur, { target: { value: '21' } });
    expect(screen.getByRole('alert').textContent).toMatch(/Plus de 20 demandes/);
  });

  it('met le canal en pause', async () => {
    await monter();
    api.enregistrerReglagesSalesnav.mockResolvedValue(reglages(8, true));
    fireEvent.click(await screen.findByLabelText('Mettre le canal en pause'));
    await waitFor(() =>
      expect(api.enregistrerReglagesSalesnav).toHaveBeenCalledWith('demo', { pause: true }),
    );
  });

  it('compte les opportunités par étape du Radar', async () => {
    await monter([affaire('a', 0), affaire('b', 0), affaire('c', 3)]);
    const bloc = screen.getByLabelText('Avancement des opportunités SalesNav');
    expect(within(bloc).getByText('À contacter').previousSibling?.textContent).toBe('2');
    expect(within(bloc).getByText('Ont répondu').previousSibling?.textContent).toBe('1');
    expect(within(bloc).getByText('À relancer').previousSibling?.textContent).toBe('0');
  });

  it('fait avancer une opportunité seule', async () => {
    const { onChange } = await monter([affaire('a', 0)]);
    api.patchFiche.mockResolvedValue({});
    fireEvent.change(screen.getByLabelText('Étape de Affaire a'), { target: { value: '1' } });
    await waitFor(() =>
      expect(api.patchFiche).toHaveBeenCalledWith('demo', 'affaire', 'a', {
        radarEtapeManuelle: 1,
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('fait avancer plusieurs opportunités à la fois', async () => {
    await monter([affaire('a', 0), affaire('b', 0), affaire('c', 0)]);
    api.patchFiche.mockResolvedValue({});
    fireEvent.click(screen.getByLabelText('Sélectionner Affaire a'));
    fireEvent.click(screen.getByLabelText('Sélectionner Affaire c'));
    fireEvent.change(screen.getByLabelText('Étape à appliquer'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    await waitFor(() => expect(api.patchFiche).toHaveBeenCalledTimes(2));
    expect(api.patchFiche).toHaveBeenCalledWith('demo', 'affaire', 'a', { radarEtapeManuelle: 2 });
    expect(api.patchFiche).toHaveBeenCalledWith('demo', 'affaire', 'c', { radarEtapeManuelle: 2 });
  });

  it('sort une sélection du canal SalesNav', async () => {
    await monter([affaire('a', 0)]);
    api.patchFiche.mockResolvedValue({});
    fireEvent.click(screen.getByLabelText('Sélectionner Affaire a'));
    fireEvent.click(screen.getByRole('button', { name: 'Sortir de SalesNav' }));
    await waitFor(() =>
      expect(api.patchFiche).toHaveBeenCalledWith('demo', 'affaire', 'a', {
        radarCanalManuel: 'À préciser',
      }),
    );
  });

  it('signale les opportunités non mises à jour et revient au Radar', async () => {
    const { onRetour } = await monter([affaire('a', 0)]);
    api.patchFiche.mockRejectedValue(new Error('refus'));
    fireEvent.click(screen.getByLabelText('Sélectionner Affaire a'));
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(await screen.findByText(/n’a pas été mise à jour/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Retour au Radar' }));
    expect(onRetour).toHaveBeenCalled();
  });
});
