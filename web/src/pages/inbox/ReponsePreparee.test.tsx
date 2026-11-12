// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReponsePreparee } from './ReponsePreparee.js';

const reponse = {
  objet: 'Re : demande fictive',
  texte: 'Bonjour Alice, voici ma réponse.',
  lienBrouillon: 'https://mail.exemple.fr/brouillon/1',
  prepareeLe: '2026-11-12T06:30:00.000Z',
};

describe('ReponsePreparee', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("montre l'objet et le texte, et le lien vers le brouillon", () => {
    render(<ReponsePreparee reponse={reponse} />);
    expect(screen.getByText('Objet : Re : demande fictive')).toBeTruthy();
    expect(screen.getByText('Bonjour Alice, voici ma réponse.')).toBeTruthy();
    const lien = screen.getByRole('link', { name: 'Ouvrir le brouillon' });
    expect(lien.getAttribute('href')).toBe('https://mail.exemple.fr/brouillon/1');
    expect(screen.getByText(/Rien n'est envoyé/)).toBeTruthy();
  });

  it("n'offre pas de lien quand le brouillon n'a pas été créé", () => {
    render(<ReponsePreparee reponse={{ ...reponse, lienBrouillon: null, objet: null }} />);
    expect(screen.queryByRole('link', { name: 'Ouvrir le brouillon' })).toBeNull();
    expect(screen.queryByText(/Objet :/)).toBeNull();
  });

  it("copie l'objet et le texte, puis le confirme", async () => {
    const ecrire = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText: ecrire } });
    render(<ReponsePreparee reponse={reponse} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copier la réponse' }));
    expect(ecrire).toHaveBeenCalledWith('Re : demande fictive\n\nBonjour Alice, voici ma réponse.');
    expect(await screen.findByText('Copiée.')).toBeTruthy();
  });

  it('prévient quand la copie est refusée', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('no')) } });
    render(<ReponsePreparee reponse={reponse} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copier la réponse' }));
    expect(await screen.findByText(/Copie impossible/)).toBeTruthy();
  });
});
