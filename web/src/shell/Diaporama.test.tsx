// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Diaporama } from './Diaporama.js';
import { ModePresentationContext } from './modePresentation.js';

afterEach(cleanup);

const slides = [
  { cle: 'a', contenu: <h2>Première</h2> },
  { cle: 'b', contenu: <h2>Deuxième</h2> },
  { cle: 'c', contenu: <h2>Troisième</h2> },
];

describe('Diaporama', () => {
  it('montre la première slide et ne laisse lisible que la slide courante', () => {
    render(<Diaporama nom="Essai" slides={slides} />);
    expect(screen.getByRole('heading', { name: 'Première' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Deuxième' })).toBeNull();
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('avance et recule avec les boutons, sans sortir des bornes', () => {
    render(<Diaporama nom="Essai" slides={slides} />);
    const precedente = screen.getByRole('button', { name: 'Slide précédente' });
    const suivante = screen.getByRole('button', { name: 'Slide suivante' });
    expect((precedente as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(suivante);
    fireEvent.click(suivante);
    expect(screen.getByRole('heading', { name: 'Troisième' })).toBeTruthy();
    expect((suivante as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(precedente);
    expect(screen.getByRole('heading', { name: 'Deuxième' })).toBeTruthy();
  });

  it('saute à une slide avec les petits ronds et repère la slide courante', () => {
    render(<Diaporama nom="Essai" slides={slides} />);
    fireEvent.click(screen.getByRole('button', { name: 'Slide 3' }));
    expect(screen.getByRole('heading', { name: 'Troisième' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Slide 3' }).getAttribute('aria-current')).toBe(
      'step',
    );
    expect(screen.getByRole('button', { name: 'Slide 1' }).getAttribute('aria-current')).toBeNull();
  });

  it('suit les flèches du clavier', () => {
    render(<Diaporama nom="Essai" slides={slides} />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Deuxième' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: 'Première' })).toBeTruthy();
  });

  it('ignore le clavier quand on écrit dans un champ', () => {
    render(
      <>
        <input aria-label="Note" />
        <Diaporama nom="Essai" slides={slides} />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText('Note'), { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Première' })).toBeTruthy();
  });

  it('bascule le mode présentation par le bouton et par la touche P', () => {
    const basculer = vi.fn();
    render(
      <ModePresentationContext.Provider value={{ actif: false, basculer }}>
        <Diaporama nom="Essai" slides={slides} />
      </ModePresentationContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mode présentation' }));
    fireEvent.keyDown(document, { key: 'p' });
    expect(basculer).toHaveBeenCalledTimes(2);
  });

  it('propose de quitter quand le mode présentation est actif', () => {
    render(
      <ModePresentationContext.Provider value={{ actif: true, basculer: () => {} }}>
        <Diaporama nom="Essai" slides={slides} />
      </ModePresentationContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Quitter la présentation' })).toBeTruthy();
  });
});
