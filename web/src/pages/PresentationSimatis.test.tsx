// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PresentationSimatis } from './PresentationSimatis.js';

afterEach(cleanup);

const aller = (n: number) => fireEvent.click(screen.getByRole('button', { name: `Slide ${n}` }));

describe('Présentation de SIMATIS', () => {
  it('s’ouvre sur la promesse, avec les logos SIMATIS et KAIROS', () => {
    render(<PresentationSimatis slug="demo" />);
    expect(
      screen.getByRole('heading', { name: 'Votre fonction commerciale tient-elle la distance ?' }),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: /SIMATIS, Conseil et Formation/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /KAIROS/ })).toBeTruthy();
    expect(screen.getByText('1 / 10')).toBeTruthy();
  });

  it('présente le portrait de Marc et ses repères', () => {
    render(<PresentationSimatis slug="demo" />);
    aller(8);
    expect(screen.getByRole('img', { name: 'Marc Tabouret' })).toBeTruthy();
    expect(screen.getByText('Près de 15 ans')).toBeTruthy();
  });

  it('garde le titre « Entouré pour aller plus loin » sur une seule ligne', () => {
    render(<PresentationSimatis slug="demo" />);
    aller(9);
    const titre = screen.getByRole('heading', { name: 'Entouré pour aller plus loin.' });
    expect(titre.style.whiteSpace).toBe('nowrap');
  });

  it('termine sur les deux outils offerts, avec lien vers leurs présentations', () => {
    render(<PresentationSimatis slug="demo" />);
    aller(10);
    expect(screen.getByText('Les deux sont offerts, sans engagement.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Diagnostic d’endurance commerciale/ }).getAttribute('href'),
    ).toBe('#/demo/presentation-diagnostic');
    const vma = screen.getByRole('link', { name: /Test VMA/ });
    expect(vma.getAttribute('href')).toBe('#/demo/presentation-vma');
    expect(vma.textContent).toMatch(/auto-test de 10 minutes, réalisé à distance/);
  });

  it('ne cite aucun tarif', () => {
    render(<PresentationSimatis slug="demo" />);
    const texte = Array.from({ length: 10 }, (_, i) => {
      aller(i + 1);
      return document.body.textContent ?? '';
    }).join(' ');
    expect(texte).not.toMatch(/€/);
  });
});
