// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OccurrenceDepense, OccurrenceRevenu } from '../../api.js';
import { Mouvements } from './Mouvements.js';
import { fusionnerMouvements } from './fusion.js';

const dep = (p: Partial<OccurrenceDepense> = {}): OccurrenceDepense => ({
  depenseId: 'd1',
  cle: 'd1',
  libelle: 'Abonnement fictif',
  categorie: 'Outils',
  date: '2026-11-10',
  montantTtcCents: 12_000,
  etat: 'a_venir',
  statut: 'prevue',
  recurrente: false,
  payeur: 'societe',
  affectations: [{ cible: 'simatis' }],
  refacturable: false,
  justificatif: null,
  refacturablePrevuCents: 0,
  refactureCents: 0,
  ...p,
});
const rec = (p: Partial<OccurrenceRevenu> = {}): OccurrenceRevenu => ({
  revenuId: 'r1',
  cle: 'r1',
  libelle: 'Mission fictive',
  type: 'commission',
  mandat: null,
  certitude: 'certaine',
  date: '2026-11-12',
  dateEncaissement: null,
  montantHtCents: 50_000,
  etat: 'prevue',
  referenceFacture: null,
  recurrente: false,
  depenseId: null,
  ...p,
});

function monter(
  depenses: OccurrenceDepense[],
  revenus: OccurrenceRevenu[],
  extra: Partial<Parameters<typeof Mouvements>[0]> = {},
) {
  const actions = {
    onOuvrir: vi.fn(),
    onDupliquer: vi.fn(),
    onRetirer: vi.fn(),
    onMarquerFacturee: vi.fn(),
    onVoirFactures: vi.fn(),
    onAjouter: vi.fn(),
  };
  render(
    <Mouvements
      mouvements={fusionnerMouvements(depenses, revenus)}
      aFacturer={[]}
      bandeau={[]}
      periode={null}
      mandats={[]}
      nomAff={() => 'SIMATIS'}
      {...actions}
      {...extra}
    />,
  );
  return actions;
}

afterEach(cleanup);

describe('Mouvements', () => {
  it('renvoie vers l’onglet Factures depuis la liste des factures à émettre', () => {
    const { onVoirFactures } = monter([], [], { aFacturer: [rec({ libelle: 'À facturer' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Voir par mandat' }));
    expect(onVoirFactures).toHaveBeenCalled();
  });

  it('affiche chaque montant signé avec sa base', () => {
    monter([dep()], [rec()]);
    const ligneD = screen.getByText('Abonnement fictif').closest('tr')!;
    expect(within(ligneD).getByText(/−\s*120 €/)).toBeTruthy();
    expect(within(ligneD).getByText('TTC')).toBeTruthy();
    const ligneR = screen.getByText('Mission fictive').closest('tr')!;
    expect(within(ligneR).getByText(/\+\s*500 €/)).toBeTruthy();
    expect(within(ligneR).getByText('HT')).toBeTruthy();
  });

  it('les puces filtrent la liste', () => {
    monter([dep()], [rec()]);
    fireEvent.click(screen.getByRole('button', { name: 'Recettes' }));
    expect(screen.queryByText('Abonnement fictif')).toBeNull();
    expect(screen.getByText('Mission fictive')).toBeTruthy();
  });

  it('filtreInitial s’applique dès le premier rendu', () => {
    monter([dep()], [rec()], { filtreInitial: 'recettes' });
    expect(screen.queryByText('Abonnement fictif')).toBeNull();
  });

  it('grise une ligne ignorée et l’exclut des totaux', () => {
    monter([dep(), dep({ cle: 'd2', libelle: 'Doublon fictif', etat: 'ignoree' })], []);
    expect(screen.getByText('Doublon fictif').closest('tr')!.className).toContain('muted');
    const totaux = screen.getByTestId('totaux');
    expect(totaux.textContent).toMatch(/120 €/);
    expect(totaux.textContent).not.toMatch(/240 €/);
  });

  it('sépare les totaux TTC et HT', () => {
    monter([dep()], [rec()]);
    const totaux = screen.getByTestId('totaux');
    expect(totaux.textContent).toMatch(/Dépenses TTC.*120 €/);
    expect(totaux.textContent).toMatch(/Recettes HT.*500 €/);
  });

  it('liste vide : invite à ajouter un mouvement', () => {
    const { onAjouter } = monter([], []);
    fireEvent.click(screen.getByRole('link', { name: 'Ajouter un mouvement' }));
    expect(onAjouter).toHaveBeenCalled();
  });

  it('un clic sur une ligne l’ouvre ; Dupliquer n’existe que pour une dépense', () => {
    const { onOuvrir } = monter([dep()], [rec()]);
    fireEvent.click(screen.getByText('Mission fictive'));
    expect(onOuvrir).toHaveBeenCalledWith(expect.objectContaining({ sens: 'recette' }));
    expect(
      within(screen.getByText('Abonnement fictif').closest('tr')!).getByRole('button', {
        name: 'Dupliquer',
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByText('Mission fictive').closest('tr')!).queryByRole('button', {
        name: 'Dupliquer',
      }),
    ).toBeNull();
  });

  it('le panneau Factures à émettre n’apparaît que s’il y en a', () => {
    monter([], [rec()]);
    expect(screen.queryByText(/Factures à émettre/)).toBeNull();
    cleanup();
    const { onMarquerFacturee } = monter([], [], { aFacturer: [rec({ libelle: 'À facturer' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Marquer facturée' }));
    expect(onMarquerFacturee).toHaveBeenCalledWith(
      expect.objectContaining({ libelle: 'À facturer' }),
    );
  });

  it('signale une recette probable ou hypothétique', () => {
    monter([], [rec({ cle: 'p', libelle: 'Probable fictive', certitude: 'probable' })]);
    expect(
      within(screen.getByText('Probable fictive').closest('tr')!).getByText('Probable', {
        selector: '.badge',
      }),
    ).toBeTruthy();
  });

  it('affiche le mandat d’une recette, y compris dans les factures à émettre', () => {
    monter([], [rec({ mandat: 'm1' })], {
      nomAff: (a) => (a.mandat ? 'Mandat test' : 'SIMATIS'),
      aFacturer: [rec({ cle: 'f', libelle: 'À facturer', mandat: 'm1' })],
    });
    expect(
      within(screen.getByText('Mission fictive').closest('tr')!).getByText('Mandat test', {
        selector: '.badge',
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByText('À facturer').closest('tr')!).getByText('Mandat test'),
    ).toBeTruthy();
  });

  it('« Ajouter un mouvement » transmet le filtre actif', () => {
    const { onAjouter } = monter([dep()], [], { filtreInitial: 'recettes' });
    fireEvent.click(screen.getByRole('link', { name: 'Ajouter un mouvement' }));
    expect(onAjouter).toHaveBeenCalledWith('recettes');
  });
});
