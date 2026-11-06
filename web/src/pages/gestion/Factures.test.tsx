// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactureAEmettre, FactureEmise, FacturesAEmettre, LigneFacture } from '../../api.js';
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
  delaiMandatJours: 45,
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
const emise = (o: Partial<FactureEmise> = {}): FactureEmise => ({
  id: 'f1',
  mandat: 'mandat-a',
  numero: 'F-2026-01',
  dateEmission: '2026-11-12',
  delaiJours: 45,
  totalHtCents: 63_000,
  etat: 'emise',
  dateEncaissement: null,
  lignes: [],
  ...o,
});
const rendre = (
  donnees: FacturesAEmettre,
  onDelai = vi.fn(),
  extra: {
    emises?: FactureEmise[];
    onEmettre?: () => Promise<boolean> | void;
    onEncaisser?: () => void;
  } = {},
) =>
  render(
    <Factures
      donnees={donnees}
      mandats={mandats}
      onDelai={onDelai}
      emises={extra.emises ?? []}
      onEmettre={extra.onEmettre ?? vi.fn()}
      onEncaisser={extra.onEncaisser ?? vi.fn()}
    />,
  );

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

  it('n’envoie rien si le délai n’a pas changé, et montre le délai général en repli', () => {
    const onDelai = vi.fn();
    rendre(
      {
        factures: [facture({ delaiMandatJours: null, delaiJours: 30 })],
        sansMandat: [],
      },
      onDelai,
    );
    const champ = screen.getByLabelText<HTMLInputElement>('Délai de paiement (jours)');
    expect(champ.value).toBe('');
    expect(champ.placeholder).toMatch(/30/);
    fireEvent.focus(champ);
    fireEvent.blur(champ);
    expect(onDelai).not.toHaveBeenCalled();
  });

  it('refuse une saisie qui n’est pas un nombre de jours, sans rien envoyer', () => {
    const onDelai = vi.fn();
    rendre({ factures: [facture()], sansMandat: [] }, onDelai);
    const champ = screen.getByLabelText('Délai de paiement (jours)');
    for (const mauvaise of ['abc', '-5', '30j', '400']) {
      fireEvent.change(champ, { target: { value: mauvaise } });
      fireEvent.blur(champ);
      expect(screen.getByRole('alert').textContent).toMatch(/0 et 365/);
    }
    expect(onDelai).not.toHaveBeenCalled();
  });

  it('sans aucune facture, dit qu’il n’y a rien à facturer', () => {
    rendre({ factures: [], sansMandat: [] });
    expect(screen.getByText('Rien à facturer')).toBeTruthy();
  });

  describe('émission et encaissement', () => {
    it('émettre ouvre un formulaire ; le bouton attend un numéro', () => {
      rendre({ factures: [facture()], sansMandat: [] });
      fireEvent.click(screen.getByRole('button', { name: 'Émettre la facture' }));
      const valider = screen.getByRole<HTMLButtonElement>('button', { name: 'Émettre' });
      expect(valider.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('Numéro de la facture'), {
        target: { value: 'F-2026-02' },
      });
      expect(valider.disabled).toBe(false);
    });

    it('garde le formulaire ouvert si l’émission est refusée', async () => {
      const onEmettre = vi.fn(() => Promise.resolve(false));
      rendre({ factures: [facture()], sansMandat: [] }, vi.fn(), { onEmettre });
      fireEvent.click(screen.getByRole('button', { name: 'Émettre la facture' }));
      fireEvent.change(screen.getByLabelText('Numéro de la facture'), {
        target: { value: 'F-DOUBLON' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Émettre' }));
      await waitFor(() => expect(onEmettre).toHaveBeenCalled());
      expect(screen.getByLabelText<HTMLInputElement>('Numéro de la facture').value).toBe(
        'F-DOUBLON',
      );
    });

    it('une ligne sans montant n’a pas de case', () => {
      rendre({
        factures: [facture({ lignes: [ligne({ cle: 'k', sorte: 'ik', montantHtCents: null })] })],
        sansMandat: [],
      });
      fireEvent.click(screen.getByRole('button', { name: 'Émettre la facture' }));
      expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('valider envoie mandat, numéro, date et les lignes décochées', () => {
      const onEmettre = vi.fn();
      rendre({ factures: [facture()], sansMandat: [] }, vi.fn(), { onEmettre });
      fireEvent.click(screen.getByRole('button', { name: 'Émettre la facture' }));
      fireEvent.change(screen.getByLabelText('Numéro de la facture'), {
        target: { value: 'F-2026-02' },
      });
      fireEvent.change(screen.getByLabelText('Date d’émission'), {
        target: { value: '2026-11-30' },
      });
      fireEvent.click(screen.getByLabelText('Inclure Train fictif'));
      fireEvent.click(screen.getByRole('button', { name: 'Émettre' }));
      expect(onEmettre).toHaveBeenCalledWith({
        mandat: 'mandat-a',
        numero: 'F-2026-02',
        dateEmission: '2026-11-30',
        exclure: ['f'],
      });
    });

    it('liste les factures émises et marque l’encaissement à la date saisie', () => {
      const onEncaisser = vi.fn();
      rendre({ factures: [], sansMandat: [] }, vi.fn(), {
        onEncaisser,
        emises: [
          emise(),
          emise({
            id: 'f2',
            numero: 'F-2026-00',
            etat: 'encaissee',
            dateEncaissement: '2026-10-20',
          }),
        ],
      });
      expect(screen.getByText('F-2026-01')).toBeTruthy();
      expect(screen.getByText('F-2026-00')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Date d’encaissement de F-2026-01'), {
        target: { value: '2026-12-20' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Marquer encaissée' }));
      expect(onEncaisser).toHaveBeenCalledWith('f1', '2026-12-20');
      expect(screen.getAllByRole('button', { name: 'Marquer encaissée' })).toHaveLength(1);
    });
  });
});
