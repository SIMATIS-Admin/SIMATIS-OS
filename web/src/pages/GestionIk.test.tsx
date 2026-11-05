// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GestionIk } from './GestionIk.js';

// Données fictives : ni taux, ni lieu, ni distance réels.
const VEH = '22222222-2222-4222-8222-222222222222';
const config = (avecBareme: boolean) => ({
  vehicules: [{ id: VEH, libelle: 'Voiture test', categorie: 'auto', puissanceFiscale: null }],
  lieux: [{ id: 'l1', nom: 'Lieu A', distanceKm: 40, origine: 'saisie' }],
  baremes: avecBareme
    ? [
        {
          id: 'b1',
          annee: 2026,
          categorie: 'auto',
          version: 1,
          source: 'Barème fictif',
          valideLe: '2026-11-03',
          tranches: [{ deKm: 0, jusquaKm: null, tauxDixMilliemes: 5000, forfaitCents: 0 }],
        },
      ]
    : [],
  mois: [],
});
const etat = (avecBareme: boolean) => ({
  mois: '2026-11',
  vehiculeId: VEH,
  abonnement: null,
  bareme: avecBareme
    ? { annee: 2026, version: 1, source: 'Barème fictif', valideLe: '2026-11-03' }
    : null,
  lignes: [
    {
      id: 't1',
      date: '2026-11-04',
      trajet: 'Domicile à Lieu A',
      commentaire: 'Réunion fictive',
      km: 40,
      statut: 'brouillon',
      cumulKm: 40,
      indemniteCents: avecBareme ? 2000 : null,
      mandat: null,
      refacturer: false,
    },
    {
      id: 't2',
      date: '2026-11-05',
      trajet: 'Retour Lieu B',
      commentaire: 'Mandat fictif',
      km: 10,
      statut: 'brouillon',
      cumulKm: 50,
      indemniteCents: avecBareme ? 500 : null,
      mandat: 'mandat-a',
      refacturer: false,
    },
  ],
  totalKm: 50,
  totalIndemniteCents: avecBareme ? 2000 : null,
  cumulAnnuelKm: 40,
  derniereDateTransmise: null,
  cca: null,
  avertissements: avecBareme ? [] : ['Aucun barème validé pour 2026 (auto) : montants absents.'],
});
const ccaVide = {
  confirmeCents: null,
  estimeCents: null,
  ouverture: null,
  mouvements: [],
  avertissements: ["Solde d'ouverture non renseigné"],
};

describe('GestionIk', () => {
  let envois: { url: string; method: string; corps: unknown }[] = [];
  const onModifie = vi.fn();
  const monter = (avecBareme: boolean) => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method !== 'GET') envois.push({ url, method, corps: JSON.parse(init?.body as string) });
        const corps = url.includes('ik/config')
          ? config(avecBareme)
          : url.includes('ik/etat')
            ? etat(avecBareme)
            : url.includes('gestion/cca')
              ? ccaVide
              : { id: 'x' };
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(corps) });
      }),
    );
    render(
      <GestionIk
        slug="simatis"
        mois="2026-11"
        periode={null}
        mandats={[{ slug: 'mandat-a', nom: 'Mandat A' }]}
        onModifie={onModifie}
      />,
    );
  };
  beforeEach(() => {
    envois = [];
    onModifie.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sans barème validé : trajets visibles, aucun montant inventé, CCA non renseigné', async () => {
    monter(false);
    await waitFor(() =>
      expect(screen.getByText('Domicile à Lieu A', { selector: 'td' })).toBeTruthy(),
    );
    expect(screen.getByText('Barème à valider')).toBeTruthy();
    expect(screen.getAllByText('Non renseigné').length).toBeGreaterThan(0);
    expect(screen.getByText(/Aucun barème validé pour 2026/)).toBeTruthy();
  });

  it('avec barème : total en euros et bouton de l’étape suivante', async () => {
    monter(true);
    await waitFor(() => expect(screen.getByText('Passer à contrôler')).toBeTruthy());
    expect(screen.getAllByText('20 €').length).toBeGreaterThan(0);
    expect(screen.getByText('Exporter en CSV').getAttribute('href')).toContain(
      `ik/export.csv?mois=2026-11&vehiculeId=${VEH}`,
    );
  });

  it('avance le mois d’un seul cran', async () => {
    monter(true);
    fireEvent.click(await screen.findByText('Passer à contrôler'));
    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]).toMatchObject({
      method: 'POST',
      corps: { vehiculeId: VEH, action: 'a_controler' },
    });
    expect(envois[0]!.url).toContain('ik/mois/2026-11/avancer');
  });

  describe('refacturation à un mandat', () => {
    it('le formulaire propose un mandat ; la case Refacturer attend qu’il soit choisi', async () => {
      monter(true);
      const mandat = await screen.findByLabelText('Mandat du trajet');
      const case_ = screen.getByLabelText<HTMLInputElement>('Refacturer ce trajet');
      expect(case_.disabled).toBe(true);
      fireEvent.change(mandat, { target: { value: 'mandat-a' } });
      expect(case_.disabled).toBe(false);
    });

    it('crée un trajet avec mandat et refacturer', async () => {
      monter(true);
      await screen.findByLabelText('Mandat du trajet');
      const formulaire = within(
        screen.getByRole('button', { name: 'Ajouter le trajet' }).closest('form')!,
      );
      fireEvent.change(formulaire.getByLabelText('Mandat du trajet'), {
        target: { value: 'mandat-a' },
      });
      fireEvent.click(formulaire.getByLabelText('Refacturer ce trajet'));
      fireEvent.change(formulaire.getByLabelText('Distance aller-retour (km)'), {
        target: { value: '40' },
      });
      fireEvent.change(formulaire.getByLabelText('Trajet'), { target: { value: 'Trajet fictif' } });
      fireEvent.change(formulaire.getByLabelText('Commentaire (client, projet, réunion)'), {
        target: { value: 'Réunion' },
      });
      fireEvent.click(formulaire.getByRole('button', { name: 'Ajouter le trajet' }));
      await waitFor(() => expect(envois).toHaveLength(1));
      expect(envois[0]).toMatchObject({
        method: 'POST',
        corps: { mandat: 'mandat-a', refacturer: true, kmAllerRetour: 40 },
      });
    });

    it('cocher Refacturer sur une ligne appelle le serveur ; désactivée sans mandat', async () => {
      monter(true);
      const sans = await screen.findByLabelText<HTMLInputElement>(
        'Refacturer le trajet du 2026-11-04',
      );
      expect(sans.disabled).toBe(true);
      fireEvent.click(screen.getByLabelText('Refacturer le trajet du 2026-11-05'));
      await waitFor(() => expect(envois).toHaveLength(1));
      expect(envois[0]).toMatchObject({
        method: 'PATCH',
        url: '/api/i/simatis/gestion/ik/trajets/t2',
        corps: { refacturer: true },
      });
      // L'onglet Factures doit se recharger : il dépend de cette case.
      await waitFor(() => expect(onModifie).toHaveBeenCalled());
    });
  });
});
