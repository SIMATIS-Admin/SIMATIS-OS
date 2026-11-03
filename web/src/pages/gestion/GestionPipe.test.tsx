// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AffairePipe } from '../../api.js';
import { GestionPipe } from './GestionPipe.js';

const affaire = (p: Partial<AffairePipe> = {}): AffairePipe => ({
  id: 'a1',
  titre: 'Affaire fictive',
  entreprise: 'Société Exemple',
  probabilite: 60,
  totalCents: 1_000_000,
  recurrent: false,
  mensuelCents: null,
  dureeMois: 12,
  signature: '2027-01-15',
  statut: 'comptee',
  ...p,
});

function monter(affaires: AffairePipe[], extra: Partial<Parameters<typeof GestionPipe>[0]> = {}) {
  const actions = { onDecalage: vi.fn(), onExclus: vi.fn(), onDate: vi.fn() };
  render(<GestionPipe affaires={affaires} decalage={0} exclus={[]} {...actions} {...extra} />);
  return actions;
}
afterEach(cleanup);

describe('GestionPipe', () => {
  it('affiche probabilité, montant, signature et valeur pondérée, avec le total', () => {
    monter([affaire()]);
    const ligne = screen.getByText('Affaire fictive').closest('tr')!;
    expect(within(ligne).getByText('60 %')).toBeTruthy();
    expect(within(ligne).getByText(/10\s?000 €/)).toBeTruthy();
    expect(within(ligne).getByText(/6\s?000 €/)).toBeTruthy();
    expect(screen.getByTestId('total-pipe').textContent).toMatch(/6\s?000 €/);
  });

  it('un abonnement affiche sa mensualité', () => {
    monter([affaire({ recurrent: true, mensuelCents: 250_000, totalCents: 3_000_000 })]);
    expect(screen.getByText(/2\s?500 € \/ mois/)).toBeTruthy();
  });

  it('le total ignore les affaires décochées', () => {
    monter([affaire()], { exclus: ['a1'] });
    expect(screen.getByTestId('total-pipe').textContent).toMatch(/^0 €|\b0 €/);
    expect(screen.getByText('Affaire fictive').closest('tr')!.className).toContain('off');
  });

  it('signale et grise une affaire sans date, sans la compter', () => {
    monter([
      affaire({ id: 'b', titre: 'Affaire non datée', signature: null, statut: 'sans_date' }),
    ]);
    const ligne = screen.getByText('Affaire non datée').closest('tr')!;
    expect(ligne.className).toContain('sans');
    expect(within(ligne).getByText('Sans date', { selector: '.badge' })).toBeTruthy();
    expect(screen.getByTestId('total-pipe').textContent).toMatch(/\b0 €/);
  });

  it('changer la date appelle onDate, la vider envoie null', () => {
    const { onDate } = monter([affaire()]);
    const champ = screen.getByLabelText('Signature estimée Affaire fictive');
    fireEvent.change(champ, { target: { value: '2027-02-01' } });
    expect(onDate).toHaveBeenCalledWith('a1', '2027-02-01');
    fireEvent.change(champ, { target: { value: '' } });
    expect(onDate).toHaveBeenLastCalledWith('a1', null);
  });

  it('décocher Compter exclut l’affaire, recocher la remet', () => {
    const { onExclus } = monter([affaire()]);
    fireEvent.click(screen.getByLabelText('Compter Affaire fictive'));
    expect(onExclus).toHaveBeenCalledWith(['a1']);
    cleanup();
    const autre = monter([affaire()], { exclus: ['a1', 'z'] });
    fireEvent.click(screen.getByLabelText('Compter Affaire fictive'));
    expect(autre.onExclus).toHaveBeenCalledWith(['z']);
  });

  it('le curseur appelle onDecalage et annonce le retard', () => {
    const { onDecalage } = monter([affaire()]);
    fireEvent.change(screen.getByLabelText('Décalage des signatures (mois)'), {
      target: { value: '3' },
    });
    expect(onDecalage).toHaveBeenCalledWith(3);
    cleanup();
    monter([affaire()], { decalage: 3 });
    expect(screen.getByText('+3 mois')).toBeTruthy();
  });

  it('sans affaire : invite à renseigner le Pipeline', () => {
    monter([]);
    expect(screen.getByText(/Aucune affaire ouverte/)).toBeTruthy();
  });
});
