// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactureAEmettre, FacturesAEmettre, LigneFacture } from '../../api.js';
import { Factures } from './Factures.js';

// Données fictives.
const ligne = (o: Partial<LigneFacture>): LigneFacture => ({
  cle: 'x',
  sorte: 'commission',
  libelle: 'Ligne fictive',
  date: '2026-11-10',
  montantHtCents: 10_000,
  tvaCents: null,
  certitude: 'certaine',
  avertissement: null,
  ...o,
});
const facture = (o: Partial<FactureAEmettre> = {}): FactureAEmettre => ({
  mandat: 'mandat-a',
  emissionPrevue: '2026-11-30',
  delaiJours: 45,
  encaissementAttendu: '2027-01-14',
  totalHtCents: 63_000,
  lignes: [
    ligne({ cle: 'c', sorte: 'commission', libelle: 'Commission fictive', montantHtCents: 50_000 }),
    ligne({ cle: 'f', sorte: 'frais', libelle: 'Train fictif', montantHtCents: 12_000 }),
    ligne({ cle: 'i', sorte: 'ik', libelle: 'Trajet fictif', montantHtCents: 1_000 }),
  ],
  avertissements: [],
  ...o,
});
const mandats = [{ slug: 'mandat-a', nom: 'Mandat A' }];
const rendre = (donnees: FacturesAEmettre, onDelai = vi.fn()) =>
  render(<Factures donnees={donnees} mandats={mandats} onDelai={onDelai} />);

afterEach(cleanup);

describe('Factures', () => {
  it('affiche une carte par mandat avec le total HT, l’émission et l’encaissement attendu', () => {
    rendre({ factures: [facture()], sansMandat: [] });
    const carte = screen.getByRole('region', { name: 'Mandat A' });
    expect(within(carte).getByText(/630\s€/)).toBeTruthy();
    expect(within(carte).getByText(/30 nov/)).toBeTruthy();
    expect(within(carte).getByText(/14 janv/)).toBeTruthy();
  });

  it('détaille les lignes par sorte', () => {
    rendre({ factures: [facture()], sansMandat: [] });
    const carte = screen.getByRole('region', { name: 'Mandat A' });
    for (const titre of ['Commission', 'Frais', 'IK'])
      expect(within(carte).getByRole('heading', { name: titre })).toBeTruthy();
    expect(within(carte).getByText('Train fictif')).toBeTruthy();
    expect(within(carte).queryByRole('heading', { name: 'Récurrent' })).toBeNull();
  });

  it('affiche les avertissements de ligne et de facture', () => {
    rendre({
      factures: [
        facture({
          encaissementAttendu: null,
          delaiJours: null,
          avertissements: ['Délai de paiement inconnu : encaissement non daté'],
          lignes: [
            ligne({ sorte: 'frais', avertissement: 'TVA à renseigner' }),
            ligne({
              cle: 'k',
              sorte: 'ik',
              montantHtCents: null,
              avertissement: 'Montant IK inconnu',
            }),
          ],
        }),
      ],
      sansMandat: [],
    });
    expect(screen.getByText('TVA à renseigner')).toBeTruthy();
    expect(screen.getByText('Montant IK inconnu')).toBeTruthy();
    expect(screen.getByText(/Délai de paiement inconnu/)).toBeTruthy();
    expect(screen.getByText('Montant inconnu')).toBeTruthy();
  });

  it('liste à part les recettes sans mandat', () => {
    rendre({ factures: [], sansMandat: [ligne({ libelle: 'Recette orpheline' })] });
    expect(screen.getByRole('heading', { name: /sans mandat/i })).toBeTruthy();
    expect(screen.getByText('Recette orpheline')).toBeTruthy();
  });

  it('saisir un délai appelle onDelai avec le nombre de jours, vide efface', () => {
    const onDelai = vi.fn();
    rendre({ factures: [facture()], sansMandat: [] }, onDelai);
    const champ = screen.getByLabelText('Délai de paiement (jours)');
    fireEvent.change(champ, { target: { value: '60' } });
    fireEvent.blur(champ);
    expect(onDelai).toHaveBeenCalledWith('mandat-a', 60);
    fireEvent.change(champ, { target: { value: '' } });
    fireEvent.blur(champ);
    expect(onDelai).toHaveBeenLastCalledWith('mandat-a', null);
  });

  it('sans aucune facture, dit qu’il n’y a rien à facturer', () => {
    rendre({ factures: [], sansMandat: [] });
    expect(screen.getByText('Rien à facturer')).toBeTruthy();
  });
});
