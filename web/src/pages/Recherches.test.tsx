// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./radar/RechercheStrategie.js', () => ({
  RechercheStrategie: ({ slug }: { slug: string }) => <p>Recherche selon l'ICP de {slug}</p>,
}));

import { Recherches } from './Recherches.js';

describe('Recherches', () => {
  afterEach(cleanup);

  it('propose trois entrées, qui ouvrent les fenêtres de la base', () => {
    render(<Recherches slug="simatis" />);
    const href = (nom: string) => screen.getByRole('link', { name: nom }).getAttribute('href');
    expect(href('Chercher des entreprises')).toBe('#/simatis/bases/ouvrir/entreprises');
    expect(href('Trouver des contacts')).toBe('#/simatis/bases/ouvrir/recherche');
    expect(href('Recherche quotidienne')).toBe('#/simatis/bases/ouvrir/routine-recherche');
    expect(screen.getByRole('link', { name: /Importer une liste/ }).getAttribute('href')).toBe(
      '#/simatis/bases/ouvrir/import',
    );
    expect(href('Voir la base des suspects')).toBe('#/simatis/bases');
  });

  it("ouvre la recherche selon l'ICP sur place, et la referme", () => {
    render(<Recherches slug="simatis" />);
    expect(screen.queryByText(/ICP de simatis/)).toBeNull();
    const carte = screen.getByRole('button', { name: /Selon mon ICP/ });
    fireEvent.click(carte);
    expect(screen.getByText(/ICP de simatis/)).toBeTruthy();
    expect(carte.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(carte);
    expect(screen.queryByText(/ICP de simatis/)).toBeNull();
  });
});
