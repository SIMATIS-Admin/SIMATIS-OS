// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { correspondAuStatut, FiltreStatut } from './FiltreStatut.js';

const lignes = [
  { statut: 'suspect' as const },
  { statut: 'suspect' as const },
  { statut: 'prospect' as const },
  { statut: 'client' as const },
];

describe('FiltreStatut', () => {
  afterEach(cleanup);

  it('affiche le nombre de fiches par statut et la base entière', () => {
    render(<FiltreStatut lignes={lignes} valeur="tous" onChange={() => undefined} />);
    expect(screen.getByRole('button', { name: /Toute la base\s*· 4/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Suspects\s*· 2/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Prospects\s*· 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Clients\s*· 1/ })).toBeTruthy();
  });

  it('marque le statut choisi et prévient au clic', () => {
    const onChange = vi.fn();
    render(<FiltreStatut lignes={lignes} valeur="suspect" onChange={onChange} />);
    expect(screen.getByRole('button', { name: /Suspects/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /Clients/ }));
    expect(onChange).toHaveBeenCalledWith('client');
  });

  it("n'affiche pas de nombre tant que la liste n'est pas chargée", () => {
    render(<FiltreStatut lignes={null} valeur="tous" onChange={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Toute la base' })).toBeTruthy();
  });

  it('filtre les lignes selon le statut choisi', () => {
    expect(lignes.filter((l) => correspondAuStatut(l, 'tous'))).toHaveLength(4);
    expect(lignes.filter((l) => correspondAuStatut(l, 'suspect'))).toHaveLength(2);
    expect(lignes.filter((l) => correspondAuStatut(l, 'client'))).toHaveLength(1);
  });
});
