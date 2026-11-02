// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PresentationDiagnostic } from './PresentationDiagnostic.js';

afterEach(cleanup);

describe('Présentation du Diagnostic d’Endurance Commerciale', () => {
  it('montre les principes, les profils, les cinq étapes et les livrables', () => {
    render(<PresentationDiagnostic />);
    for (const titre of ['Les grands principes', 'Les cinq étapes', 'Les livrables'])
      expect(screen.getByRole('heading', { name: titre })).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(9);
    expect(screen.getByText('Ultra-endurant')).toBeTruthy();
    expect(screen.getByText('Restitution et capitalisation')).toBeTruthy();
  });
  it('introduit les trois dimensions, le logo et la distinction avec le test VMA', () => {
    render(<PresentationDiagnostic />);
    expect(
      screen.getByRole('img', { name: /piste de course et flèche de progression/ }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Outils & méthode' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Stratégie & régularité' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Polyvalence' })).toBeTruthy();
    expect(screen.getByText('Quelle différence avec le test VMA ?')).toBeTruthy();
  });
});
