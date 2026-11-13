// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SujetVue } from '../../api.js';
import { CompteRendu } from './CompteRendu.js';

const sujet = (prepare: SujetVue['compteRenduPrepare']) =>
  ({ id: 's-1', compteRenduPrepare: prepare }) as SujetVue;

describe('CompteRendu', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('[]'))),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('commence vide quand la routine n’a rien préparé', () => {
    render(<CompteRendu slug="simatis" s={sujet(null)} onEnregistrer={vi.fn()} />);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Compte rendu').value).toBe('');
    expect(screen.queryByText(/Brouillon préparé/)).toBeNull();
  });

  it('remplit le champ avec le brouillon préparé, modifiable avant enregistrement', () => {
    const onEnregistrer = vi.fn();
    render(
      <CompteRendu
        slug="simatis"
        s={sujet({ texte: 'Points abordés : budget fictif.', prepareeLe: '2026-11-12T06:30:00Z' })}
        onEnregistrer={onEnregistrer}
      />,
    );
    const champ = screen.getByLabelText<HTMLTextAreaElement>('Compte rendu');
    expect(champ.value).toBe('Points abordés : budget fictif.');
    expect(screen.getByText(/Brouillon préparé/)).toBeTruthy();
    fireEvent.change(champ, { target: { value: 'Points abordés : budget corrigé.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le compte rendu' }));
    expect(onEnregistrer).toHaveBeenCalledWith({ texte: 'Points abordés : budget corrigé.' });
  });

  it('reprend le résumé Wispr Flow quand rien n’a été préparé, et le dit', () => {
    const wispr = {
      id: 's-2',
      compteRenduPrepare: null,
      reunion: { resume: 'Résumé fictif de la réunion.' },
    } as unknown as SujetVue;
    render(<CompteRendu slug="simatis" s={wispr} onEnregistrer={vi.fn()} />);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Compte rendu').value).toBe(
      'Résumé fictif de la réunion.',
    );
    expect(screen.getByText(/Résumé repris de Wispr Flow/)).toBeTruthy();
  });
});
