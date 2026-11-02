// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { FreinVma, TestVma } from '../../api.js';
import { ResultatComplet } from './ResultatComplet.js';

afterEach(cleanup);

const frein = (n: number, titre: string): FreinVma => ({
  n,
  titre,
  phrase: `Phrase ${titre}.`,
  enjeu: 5000,
  reponse: `Réponse ${titre}`,
  debut: [`Action ${titre}`],
  signe: `Signe ${titre}`,
});

const test = (resultat: Partial<NonNullable<TestVma['resultat']>>): TestVma => ({
  id: 't1',
  entrepriseId: null,
  entrepriseNom: 'Atelier Fictif',
  contactNom: null,
  contactEmail: null,
  tutoiement: false,
  envoyeeLe: null,
  relances: [],
  echecEnvoi: null,
  mailOuvertLe: null,
  lienOuvertLe: null,
  type: 'essai',
  statut: 'utilisee',
  lien: 'https://www.simatis.fr/test-vma?i=abc',
  expireLe: '2099-01-01T00:00:00.000Z',
  creeLe: '2026-10-20T08:00:00.000Z',
  recueLe: '2026-10-22T09:00:00.000Z',
  version: '2.2',
  calcul: null,
  resultat: {
    entreprise: 'Atelier Fictif',
    vma: 14000,
    mesurable: true,
    statut: 'prouvée',
    tenue: 'en dents de scie',
    recurrent: 80000,
    allureActuelle: 94000,
    trajectoire: 107000,
    socleEcheance: 107000,
    allureVisee: 125000,
    echeance: 2,
    niveau: { cle: 'real', label: 'Réaliste', phrase: 'Phrase fictive.' },
    ecart: 18000,
    freins: [frein(1, 'Frein A'), frein(9, 'Frein B')],
    ...resultat,
  },
});

describe('Résultat complet : même contenu que le mail', () => {
  it('compares current, projected and target values on the same scale with direct labels', () => {
    const { container } = render(<ResultatComplet onRetour={() => {}} test={test({})} />);
    const figure = screen.getByRole('figure', { name: 'Comparaison des allures commerciales' });
    expect(within(figure).getByText('Aujourd’hui')).toBeTruthy();
    expect(within(figure).getByText('Sur votre lancée dans 2 ans')).toBeTruthy();
    expect(within(figure).getByText('Objectif')).toBeTruthy();
    const widths = [...container.querySelectorAll<HTMLElement>('.rc-comparaison-rail > span')].map(
      (bar) => parseFloat(bar.style.width),
    );
    expect(widths).toHaveLength(3);
    expect(widths[0]! / widths[2]!).toBeCloseTo(94000 / 125000, 2);
    expect(widths[1]! / widths[2]!).toBeCloseTo(107000 / 125000, 2);
    expect(widths.every((w) => w >= 0 && w <= 100)).toBe(true);
  });

  it('does not draw a projected value when no recurring base is known', () => {
    render(
      <ResultatComplet onRetour={() => {}} test={test({ recurrent: null, trajectoire: null })} />,
    );
    const figure = screen.getByRole('figure', { name: 'Comparaison des allures commerciales' });
    expect(within(figure).queryByText(/Sur votre lancée/)).toBeNull();
  });

  it('mode portefeuille : allure en tête, socle et nouvelles affaires, deux listes de freins', () => {
    render(
      <ResultatComplet
        onRetour={() => {}}
        test={test({
          modePortefeuille: true,
          spotCible: 18600,
          spotEcheance: 0,
          ecartSpot: 18600,
          recurrentCible: 106400,
          ecartRecurrent: -600,
          freinsConquete: [frein(1, 'Frein A')],
          freinsPortefeuille: [frein(9, 'Frein B')],
          textes: { titreConquete: 'Conquête fictive', titrePortefeuille: 'Portefeuille fictif' },
        })}
      />,
    );
    expect(screen.getByText('Votre allure commerciale')).toBeTruthy();
    expect(screen.getByText(/de CA commandé par mois, soit 1,13.M€ par an/)).toBeTruthy();
    expect(screen.getByText(/Socle récurrent : 80.k€ par mois/)).toBeTruthy();
    expect(screen.getByText(/Nouvelles affaires : 14.k€ par mois/)).toBeTruthy();
    expect(screen.queryByText('Votre VMA commerciale')).toBeNull();
    expect(screen.getByText('Conquête fictive')).toBeTruthy();
    expect(screen.getByText('Portefeuille fictif')).toBeTruthy();
    expect(screen.getByText(/Nouvelles affaires : votre cible est de 18,6.k€/)).toBeTruthy();
    expect(
      screen.getByText(/Socle récurrent : votre cible de 106,4.k€ par mois est couverte/),
    ).toBeTruthy();
    expect(screen.getAllByText('Frein A')).toHaveLength(1);
    expect(screen.getAllByText('Frein B')).toHaveLength(1);
  });

  it('sans mode portefeuille : garde la VMA en tête et une seule liste de freins', () => {
    render(<ResultatComplet onRetour={() => {}} test={test({ modePortefeuille: false })} />);
    expect(screen.getByText('Votre VMA commerciale')).toBeTruthy();
    expect(screen.getByText(/= allure actuelle : 94.k€ par mois/)).toBeTruthy();
    expect(screen.getByText('Frein A')).toBeTruthy();
    expect(screen.getByText('Frein B')).toBeTruthy();
  });
});
