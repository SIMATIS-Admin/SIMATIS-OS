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
});
