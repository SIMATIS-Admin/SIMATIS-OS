// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { InstanceSummary } from '../nav.js';
import { Sidebar } from './Sidebar.js';

const simatis: InstanceSummary = {
  slug: 'simatis',
  nom: 'SIMATIS',
  sous: 'Mon activité',
  type: 'propre',
  phase: null,
  couleur: '#41A594',
  modules: ['devis'],
};
const mandat: InstanceSummary = {
  slug: 'helioval',
  nom: 'Helioval',
  sous: 'Mandat fictif',
  type: 'mandat',
  phase: 'en_cours',
  couleur: '#4C8DD6',
  modules: ['relais'],
};

const renderSidebar = (
  current: InstanceSummary,
  favoris: string[],
  compteurs?: Record<string, number>,
) =>
  render(
    <Sidebar
      instances={[simatis, mandat]}
      current={current}
      view="entreprises"
      open={false}
      favoris={favoris}
      compteurs={compteurs}
      onToggleFavori={() => undefined}
      onMoveFavori={() => undefined}
    />,
  );

describe('Sidebar', () => {
  afterEach(cleanup);

  it('shows the Favourites group first, in the saved order', () => {
    const { container } = renderSidebar(simatis, ['pipeline', 'brief']);
    const groups = container.querySelectorAll('.nav-group');
    expect(groups[0]?.classList.contains('favs')).toBe(true);
    const labels = [...(groups[0]?.querySelectorAll('.lbl') ?? [])].map((n) => n.textContent);
    expect(labels).toEqual(['Pipeline', 'Brief du jour']);
  });

  it('hides Devis for a mandate, even when it is a favourite', () => {
    renderSidebar(mandat, ['devis']);
    expect(screen.queryByText('Devis')).toBeNull();
    expect(screen.getByText('Relais internes')).toBeTruthy();
  });

  it('shows Devis for the own activity', () => {
    renderSidebar(simatis, []);
    expect(screen.getByText('Devis')).toBeTruthy();
  });

  it('marks screens not built yet with « Bientôt »', () => {
    renderSidebar(simatis, []);
    const bases = screen.getByText('Bases vivantes').closest('a');
    const contacts = screen.getByText('Contacts').closest('a');
    expect(bases && within(bases).queryByText('Bientôt')).toBeTruthy();
    expect(contacts && within(contacts).queryByText('Bientôt')).toBeNull();
  });

  it('shows a red badge with the count of activities to do, not when zero', () => {
    renderSidebar(simatis, [], { agenda: 7 });
    const lien = screen.getAllByRole('link').find((a) => a.textContent?.startsWith('Agenda'));
    expect(lien && within(lien).getByText('7')).toBeTruthy();
    cleanup();
    renderSidebar(simatis, [], { agenda: 0 });
    const vide = screen.getAllByRole('link').find((a) => a.textContent?.startsWith('Agenda'));
    expect(vide?.querySelector('.pastille')).toBeNull();
  });

  it('folds a section on click, and keeps the favourites open', () => {
    renderSidebar(simatis, []);
    const sections = document.querySelectorAll<HTMLButtonElement>('.nav-group > .later-btn');
    const section = [...sections].find((b) => b.getAttribute('aria-expanded') === 'true');
    if (!section) throw new Error('aucune section ouverte');
    const avant = document.querySelectorAll('.nav a').length;
    fireEvent.click(section);
    expect(section.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('.nav a').length).toBeLessThan(avant);
    fireEvent.click(section);
    expect(document.querySelectorAll('.nav a').length).toBe(avant);
  });

  it('shows no favourites group when nothing is a favourite, and folds « Plus tard » by default', () => {
    renderSidebar(simatis, []);
    expect(document.querySelector('.nav-group.favs')).toBeNull();
    const plusTard = document.querySelector('.nav-group.later > .later-btn');
    expect(plusTard?.getAttribute('aria-expanded')).toBe('false');
  });

  it('narrows to icons on click, remembers it, and widens back', () => {
    renderSidebar(simatis, []);
    const bouton = screen.getByRole('button', { name: 'Réduire le menu' });
    fireEvent.click(bouton);
    expect(document.querySelector('.side')?.classList.contains('reduite')).toBe(true);
    // Labels hidden by the narrow bar still show on hover.
    const agenda = screen.getAllByRole('link').find((a) => a.textContent?.startsWith('Agenda'));
    expect(agenda?.getAttribute('title')).toBe('Agenda');
    cleanup();
    renderSidebar(simatis, []);
    expect(document.querySelector('.side')?.classList.contains('reduite')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Agrandir le menu' }));
    expect(document.querySelector('.side')?.classList.contains('reduite')).toBe(false);
  });

  it('shows the SIMATIS logo, not a plain letter', () => {
    renderSidebar(simatis, []);
    expect(document.querySelector('.brand-mark')?.tagName).toBe('IMG');
  });
});
