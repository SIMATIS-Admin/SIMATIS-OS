// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AtelierVue } from './AtelierVue.js';
import { etatVide, type EtatAtelier } from './etat.js';

const api = vi.hoisted(() => ({ majAtelier: vi.fn() }));
vi.mock('../../api.js', () => api);

const reference = (step = 3): EtatAtelier => ({
  ...etatVide(),
  step,
  obj: { ca: 120000, part: 40, panier: 3000, abo: 300, mois: 6, tx1: 25, tx2: 15, taux: 10 },
});
// Les assertions partielles de Vitest sont typées `any` : on les range derrière `unknown`.
const contient = (o: object): unknown => expect.objectContaining(o);
const atelier = { id: 'a1', titre: 'Atelier fictif', entrepriseNom: 'Entreprise Fictive' };
const monte = (props: Partial<Parameters<typeof AtelierVue>[0]> = {}) =>
  render(
    <AtelierVue
      slug="demo"
      atelier={atelier}
      etatInitial={reference()}
      essai={false}
      onRetour={() => undefined}
      {...props}
    />,
  );
const sansEspaces = (s: string | null) => (s ?? '').replace(/\s/g, '');

describe('Atelier ouvert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    api.majAtelier.mockResolvedValue({});
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('s’ouvre à l’étape enregistrée', () => {
    monte();
    expect(
      screen.getByRole('button', { name: /Étape 4.*Objectifs/ }).getAttribute('aria-current'),
    ).toBe('step');
    expect(screen.getByLabelText('Chiffre d’affaires visé (€)')).toBeTruthy();
  });

  it('changer d’étape enregistre le contenu après le délai, pas avant', () => {
    monte();
    fireEvent.click(screen.getByRole('button', { name: 'Étape suivante →' }));
    expect(api.majAtelier).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(api.majAtelier).toHaveBeenCalledTimes(1);
    expect(api.majAtelier).toHaveBeenCalledWith('demo', 'a1', {
      etat: contient({ step: 4 }),
    });
  });

  it('quitter avant le délai enregistre quand même la dernière modification', () => {
    const { unmount } = monte();
    fireEvent.change(screen.getByLabelText('Chiffre d’affaires visé (€)'), {
      target: { value: '150000' },
    });
    unmount();
    expect(api.majAtelier).toHaveBeenCalledTimes(1);
    expect(api.majAtelier).toHaveBeenCalledWith('demo', 'a1', {
      etat: contient({ obj: contient({ ca: '150000' }) }),
    });
  });

  it('ne réenregistre pas quand rien n’a changé', () => {
    const { unmount } = monte();
    unmount();
    expect(api.majAtelier).not.toHaveBeenCalled();
  });

  it('le module d’essai n’appelle jamais majAtelier', () => {
    const { unmount } = monte({ atelier: null, essai: true });
    fireEvent.change(screen.getByLabelText('Chiffre d’affaires visé (€)'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Étape suivante →' }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    unmount();
    expect(api.majAtelier).not.toHaveBeenCalled();
  });

  it('le bandeau d’essai s’affiche et le retour revient à l’accueil', () => {
    const onRetour = vi.fn();
    monte({ atelier: null, essai: true, onRetour });
    expect(screen.getByText(/rien n’est enregistré dans l’OS/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ateliers/ }));
    expect(onRetour).toHaveBeenCalled();
  });

  it('l’écran partagé masque la carte Pour Marc et le bouton la révèle', () => {
    monte();
    expect(screen.queryByText('Pour Marc')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Écran partagé/ }));
    expect(screen.getByText('Pour Marc')).toBeTruthy();
    expect(sansEspaces(screen.getByTestId('k-commission').textContent)).toBe('12000€');
    expect(sansEspaces(screen.getByTestId('k-commission-rec').textContent)).toBe('9720€');
  });

  it('les résultats d’objectifs reprennent les valeurs de référence', () => {
    monte();
    expect(screen.getByTestId('k-ventes').textContent).toBe('24');
    expect(screen.getByTestId('k-abonnes').textContent).toBe('27');
    expect(sansEspaces(screen.getByTestId('k-mrr').textContent)).toBe('8100€');
    expect(screen.getByTestId('k-rdv').textContent).toBe('204');
    expect(sansEspaces(screen.getByTestId('k-contacts').textContent)).toBe('1360');
  });

  it('modifier un champ met à jour les résultats', () => {
    monte();
    fireEvent.change(screen.getByLabelText('Part en abonnement (%)'), { target: { value: '0' } });
    expect(screen.getByTestId('k-abonnes').textContent).toBe('0');
    expect(screen.getByTestId('k-ventes').textContent).toBe('40');
  });

  it('affiche le contenu de chacune des trois premières étapes', () => {
    monte({ etatInitial: reference(0) });
    expect(screen.getByRole('button', { name: 'Ajouter une information' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Étape suivante →' }));
    expect(screen.getByLabelText('Diagnostic d’endurance')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Étape suivante →' }));
    expect(screen.getByRole('heading', { name: 'Vision' })).toBeTruthy();
  });

  it('les notes réservées n’existent qu’hors écran partagé et s’enregistrent', () => {
    const { unmount } = monte({ etatInitial: reference(0) });
    expect(screen.queryByLabelText('Notes réservées')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Écran partagé/ }));
    fireEvent.change(screen.getByLabelText('Notes réservées'), {
      target: { value: 'note fictive' },
    });
    unmount();
    expect(api.majAtelier).toHaveBeenCalledWith('demo', 'a1', {
      etat: contient({ notes: ['note fictive', '', '', '', '', ''] }),
    });
  });
});
