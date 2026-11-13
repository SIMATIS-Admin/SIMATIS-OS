// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('shows the roadmap button last, only in Mon activité with the second brain', () => {
    const { container, unmount } = renderSidebar({ ...simatis, modules: ['cerveau'] }, []);
    const lien = screen.getByRole('link', { name: /Feuille de route de l’OS/ });
    expect(lien.getAttribute('href')).toBe('#/simatis/feuille-de-route-os');
    expect(container.querySelector('nav')?.compareDocumentPosition(lien)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    unmount();
    renderSidebar(simatis, []);
    expect(screen.queryByRole('link', { name: /Feuille de route de l’OS/ })).toBeNull();
    cleanup();
    renderSidebar({ ...mandat, modules: ['cerveau'] }, []);
    expect(screen.queryByRole('link', { name: /Feuille de route de l’OS/ })).toBeNull();
  });

  it('shows Gestion in the fixed zone, right above the roadmap, only in Mon activité', () => {
    const { container, unmount } = renderSidebar(
      { ...simatis, modules: ['cerveau', 'gestion'] },
      [],
    );
    const gestion = screen.getByRole('link', { name: /Gestion/ });
    const feuille = screen.getByRole('link', { name: /Feuille de route de l’OS/ });
    expect(gestion.getAttribute('href')).toBe('#/simatis/gestion');
    expect(gestion.parentElement).toBe(feuille.parentElement);
    expect(gestion.compareDocumentPosition(feuille)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(container.querySelector('nav')?.contains(gestion)).toBe(false);
    unmount();
    renderSidebar(simatis, []);
    expect(screen.queryByRole('link', { name: /Gestion/ })).toBeNull();
    cleanup();
    renderSidebar({ ...mandat, modules: ['gestion'] }, []);
    expect(screen.queryByRole('link', { name: /Gestion/ })).toBeNull();
  });

  it('groups Mon espace along the sales cycle, with the day first', () => {
    const { container } = renderSidebar(simatis, []);
    const titres = [...container.querySelectorAll('.nav-group > .later-btn')].map((b) =>
      b.textContent?.trim(),
    );
    expect(titres).toEqual([
      'Ma journée',
      'Détecter',
      'Vendre',
      'Ma base',
      "Piloter l'activité",
      'Plus',
    ]);
    const groupes = [...container.querySelectorAll('.nav-group:not(.cockpit-fixe)')];
    const libelles = (i: number) =>
      [...(groupes[i]?.querySelectorAll('.lbl') ?? [])].map((n) => n.textContent);
    expect(libelles(0)).toEqual(['Cockpit', 'Agenda']);
    expect(libelles(1)).toEqual(['Radar', 'Recherches', 'ICP', 'Campagnes', 'Base des suspects']);
    expect(libelles(2)).toContain('Pipeline');
    expect(libelles(3)).toEqual(['Entreprises', 'Contacts']);
  });

  it('pins the Cockpit above Mon espace, which also lists it', () => {
    const { container } = renderSidebar(simatis, []);
    const nav = container.querySelector('nav')!;
    const premier = nav.querySelector('a');
    expect(premier?.textContent).toContain('Cockpit');
    expect(nav.querySelector('.nav-espace-titre')?.textContent).toBe('Mon espace');
    expect(screen.getAllByRole('link', { name: /Cockpit/ })).toHaveLength(2);
  });

  it('shows Campagnes and the Base des suspects as their own entries, lit only on their own screen', () => {
    const { container } = render(
      <Sidebar
        instances={[simatis, mandat]}
        current={simatis}
        view="prospection"
        open={false}
        favoris={[]}
        onToggleFavori={() => undefined}
        onMoveFavori={() => undefined}
      />,
    );
    expect(screen.getByRole('link', { name: /Base des suspects/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Campagnes/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: /Radar/ }).getAttribute('aria-current')).toBeNull();
    expect(container.querySelectorAll('.nav a.on')).toHaveLength(1);
  });

  it('keeps a favourite in its section: it appears twice, above and in Mon espace', () => {
    renderSidebar(simatis, ['pipeline']);
    expect(screen.getAllByText('Pipeline')).toHaveLength(2);
    const favs = document.querySelector('.nav-group.favs');
    expect(favs?.textContent).toContain('Pipeline');
    const dansEspace = [...document.querySelectorAll('.nav-group:not(.favs) a')].filter((a) =>
      a.textContent?.includes('Pipeline'),
    );
    expect(dansEspace).toHaveLength(1);
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
    renderSidebar(mandat, []);
    const relais = screen.getByText('Relais internes').closest('a');
    const contacts = screen.getByText('Contacts').closest('a');
    expect(relais && within(relais).queryByText('Bientôt')).toBeTruthy();
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

  it('shows no favourites group when nothing is a favourite, and folds « Plus » by default', () => {
    renderSidebar(simatis, []);
    expect(document.querySelector('.nav-group.favs')).toBeNull();
    const plus = document.querySelector('.nav-group.later > .later-btn');
    expect(plus?.getAttribute('aria-expanded')).toBe('false');
  });

  it('reloads the app from the button next to the logo', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderSidebar(simatis, []);
    fireEvent.click(screen.getByRole('button', { name: "Recharger l'OS" }));
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
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

  it('shows every section without a toggle, with one entry per screen when nothing is a favourite', () => {
    renderSidebar(simatis, []);
    expect(screen.queryByRole('button', { name: 'Mes espaces' })).toBeNull();
    expect(screen.getByRole('link', { name: /Contacts/ })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Pipeline/ })).toHaveLength(1);
  });

  it('shows the SIMATIS logo, not a plain letter', () => {
    renderSidebar(simatis, []);
    expect(document.querySelector('.brand-mark')?.tagName).toBe('IMG');
  });

  it('keeps favourite controls outside links and exposes reorder buttons', () => {
    const move = vi.fn();
    const { container } = render(
      <Sidebar
        instances={[simatis, mandat]}
        current={simatis}
        view="entreprises"
        open={false}
        favoris={['prospection', 'bases']}
        onToggleFavori={() => undefined}
        onMoveFavori={move}
      />,
    );
    expect(container.querySelector('a button, a [role="button"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Descendre Campagnes' }));
    expect(move).toHaveBeenCalledWith('prospection', 'bases', true);
  });

  it('offers no star on the entries that carry a notification counter', () => {
    renderSidebar(simatis, [], { cockpit: 3 });
    expect(screen.queryAllByRole('button', { name: /favoris/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Ajouter Cockpit aux favoris' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ajouter Agenda aux favoris' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ajouter Rendez-vous aux favoris' })).toBeNull();
  });
});
