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
  surcharge: false,
  statut: 'comptee',
  ...p,
});

function monter(affaires: AffairePipe[], extra: Partial<Parameters<typeof GestionPipe>[0]> = {}) {
  const actions = {
    onDecalage: vi.fn(),
    onExclus: vi.fn(),
    onDate: vi.fn(),
    onInclure: vi.fn(),
    onHypothese: vi.fn(),
    onReinitialiser: vi.fn(),
  };
  render(
    <GestionPipe
      affaires={affaires}
      decalage={0}
      exclus={[]}
      inclure
      hypotheses={{}}
      {...actions}
      {...extra}
    />,
  );
  return actions;
}
afterEach(cleanup);

describe('GestionPipe', () => {
  it('affiche probabilité, montant, signature et valeur pondérée, avec le total', () => {
    monter([affaire()]);
    const ligne = screen.getByText('Affaire fictive').closest('tr')!;
    expect(within(ligne).getByLabelText<HTMLInputElement>(/Probabilité/).value).toBe('60');
    expect(within(ligne).getByLabelText<HTMLInputElement>(/Montant/).value).toBe('10000');
    expect(within(ligne).getByText(/6\s?000 €/)).toBeTruthy();
    expect(screen.getByTestId('total-pipe').textContent).toMatch(/6\s?000 €/);
  });

  it('un abonnement affiche sa mensualité', () => {
    monter([affaire({ recurrent: true, mensuelCents: 250_000, totalCents: 3_000_000 })]);
    expect(screen.getByLabelText<HTMLInputElement>(/Montant/).value).toBe('2500');
    expect(screen.getByText('€ / mois')).toBeTruthy();
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
    fireEvent.blur(champ);
    expect(onDate).toHaveBeenCalledWith('a1', '2027-02-01');
    fireEvent.change(champ, { target: { value: '' } });
    fireEvent.blur(champ);
    expect(onDate).toHaveBeenLastCalledWith('a1', null);
  });

  it('n’enregistre pas pendant la frappe, ni une année absurde', () => {
    const { onDate } = monter([affaire()]);
    const champ = screen.getByLabelText('Signature estimée Affaire fictive');
    fireEvent.change(champ, { target: { value: '0002-02-01' } });
    expect(onDate).not.toHaveBeenCalled();
    fireEvent.blur(champ);
    expect(onDate).not.toHaveBeenCalled();
  });

  it('prévient que « Compter » n’est pas mémorisé, à cause du double compte', () => {
    monter([affaire()]);
    expect(screen.getByText(/ne sont pas mémorisées/)).toBeTruthy();
    expect(screen.getByText('Valeur pondérée des affaires comptées')).toBeTruthy();
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

  it('affiche côte à côte le total pondéré et le montant total', () => {
    monter([affaire(), affaire({ id: 'b', titre: 'Autre', totalCents: 500_000, probabilite: 20 })]);
    expect(screen.getByTestId('total-pipe').textContent).toMatch(/7\s?000 €/);
    expect(screen.getByTestId('total-brut-pipe').textContent).toMatch(/15\s?000 €/);
  });

  it('l’interrupteur prévient le parent ; pipe exclu, le tableau le dit', () => {
    const { onInclure } = monter([affaire()]);
    fireEvent.click(screen.getByLabelText(/Inclure le pipe/));
    expect(onInclure).toHaveBeenCalledWith(false);
    cleanup();
    monter([affaire()], { inclure: false });
    expect(screen.getByText('pipe exclu')).toBeTruthy();
  });

  it('modifier probabilité et montant envoie l’hypothèse, en gardant l’autre champ', () => {
    const { onHypothese } = monter([affaire()], { hypotheses: { a1: { montant: 8000 } } });
    const proba = screen.getByLabelText(/Probabilité/);
    fireEvent.change(proba, { target: { value: '35' } });
    fireEvent.blur(proba);
    expect(onHypothese).toHaveBeenCalledWith('a1', { montant: 8000, probabilite: 35 });
    const montant = screen.getByLabelText(/Montant/);
    fireEvent.change(montant, { target: { value: '12000' } });
    fireEvent.blur(montant);
    expect(onHypothese).toHaveBeenLastCalledWith('a1', { montant: 12000 });
  });

  it('vider les deux champs supprime l’hypothèse ; une probabilité > 100 est refusée', () => {
    const { onHypothese } = monter([affaire()], { hypotheses: { a1: { probabilite: 30 } } });
    const proba = screen.getByLabelText(/Probabilité/);
    fireEvent.change(proba, { target: { value: '150' } });
    fireEvent.blur(proba);
    expect(onHypothese).not.toHaveBeenCalled();
    fireEvent.change(proba, { target: { value: '' } });
    fireEvent.blur(proba);
    expect(onHypothese).toHaveBeenCalledWith('a1', null);
  });

  it('signale une affaire modifiée et propose de réinitialiser', () => {
    const { onReinitialiser } = monter([affaire({ surcharge: true })], {
      hypotheses: { a1: { montant: 5000 } },
    });
    expect(screen.getByText('modifié')).toBeTruthy();
    fireEvent.click(screen.getByText('Réinitialiser les hypothèses'));
    expect(onReinitialiser).toHaveBeenCalled();
  });
});
