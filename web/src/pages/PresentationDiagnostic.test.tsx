// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PresentationDiagnostic } from './PresentationDiagnostic.js';

afterEach(cleanup);

const suivante = () => fireEvent.click(screen.getByRole('button', { name: 'Slide suivante' }));

describe('Présentation du Diagnostic d’Endurance Commerciale', () => {
  it('s’ouvre sur le titre, avec le logo et le retour vers les outils', () => {
    render(<PresentationDiagnostic slug="demo" />);
    expect(
      screen.getByRole('heading', { name: 'Une organisation commerciale qui tient la distance.' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /piste de course et flèche de progression/ }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '← Outils et diagnostics' }).getAttribute('href')).toBe(
      '#/demo/diagnostics',
    );
  });

  it('déroule huit slides, une idée par slide', () => {
    render(<PresentationDiagnostic slug="demo" />);
    expect(screen.getByText('1 / 8')).toBeTruthy();
    for (const titre of [
      'Une bonne année ne suffit pas à faire un système solide.',
      'Trois dimensions pour comprendre l’ensemble.',
      'Les grands principes',
      'Quatre profils, comme en course à pied',
      'Les cinq étapes',
      'Les livrables',
      'Trois questions fréquentes.',
    ]) {
      suivante();
      expect(screen.getByRole('heading', { name: titre })).toBeTruthy();
    }
    expect(screen.getByText('8 / 8')).toBeTruthy();
  });

  it('garde le contenu : dimensions, profils, étapes et distinction avec le test VMA', () => {
    render(<PresentationDiagnostic slug="demo" />);
    fireEvent.click(screen.getByRole('button', { name: 'Slide 3' }));
    for (const nom of ['Outils & méthode', 'Stratégie & régularité', 'Polyvalence'])
      expect(screen.getByRole('heading', { name: nom })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Slide 5' }));
    expect(screen.getByText('Ultra-endurant')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Slide 6' }));
    expect(screen.getByText('Restitution et capitalisation')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Slide 8' }));
    expect(
      screen.getByRole('heading', { name: 'Quelle différence avec le test VMA ?' }),
    ).toBeTruthy();
  });
});
