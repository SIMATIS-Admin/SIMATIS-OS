// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { InstanceSummary } from '../nav.js';
import { Sidebar } from './Sidebar.js';

const simatis: InstanceSummary = {
  slug: 'simatis',
  nom: 'SIMATIS',
  sous: 'Mon activité',
  type: 'propre',
  couleur: '#41A594',
  modules: ['devis'],
};
const mandat: InstanceSummary = {
  slug: 'helioval',
  nom: 'Helioval',
  sous: 'Mandat fictif',
  type: 'mandat',
  couleur: '#4C8DD6',
  modules: ['relais'],
};

const renderSidebar = (current: InstanceSummary, favoris: string[]) =>
  render(
    <Sidebar
      instances={[simatis, mandat]}
      current={current}
      view="entreprises"
      open={false}
      favoris={favoris}
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
    const devis = screen.getByText('Devis').closest('a');
    const contacts = screen.getByText('Contacts').closest('a');
    expect(devis && within(devis).queryByText('Bientôt')).toBeTruthy();
    expect(contacts && within(contacts).queryByText('Bientôt')).toBeNull();
  });
});
