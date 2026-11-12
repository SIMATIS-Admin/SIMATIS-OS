// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutresAutomatismes, phraseEtat, phrasePassage } from './Autres.js';

describe('phrases des automatismes d’autres écrans', () => {
  it('dit si l’automatisme est actif et à quelle heure', () => {
    expect(phraseEtat({ active: true, heure: '10:00' })).toBe('Activé, chaque jour à 10:00');
    expect(phraseEtat({ active: false, heure: '10:00' })).toBe('En pause');
  });
  it('dit quand il est passé et ce qu’il a fait', () => {
    expect(phrasePassage({})).toBe('Pas encore passé.');
    expect(phrasePassage({ dernierJour: '2026-11-11' })).toBe('Dernier passage : 11/11/2026.');
    expect(phrasePassage({ dernierJour: '2026-11-11', bilan: '3 brouillons préparés' })).toBe(
      'Dernier passage : 11/11/2026. 3 brouillons préparés',
    );
  });
});

describe('AutresAutomatismes', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const repondre = (par: Record<string, unknown>) =>
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const cle = Object.keys(par).find((c) => url.endsWith(c));
        return Promise.resolve(
          cle === undefined
            ? new Response('non', { status: 500 })
            : new Response(JSON.stringify(par[cle])),
        );
      }),
    );

  it('montre les trois automatismes cachés, leur état et où les régler', async () => {
    repondre({
      '/prospection/routine': {
        active: true,
        heure: '10:00',
        dernierJour: '2026-11-11',
        bilan: '5 brouillons',
      },
      '/base/recherche/routine': { active: false, heure: '09:00', consignes: 'x', nombre: 10 },
      '/base/signaux/routine': { active: true, heure: '08:00' },
    });
    render(<AutresAutomatismes slug="simatis" />);
    const section = await screen.findByRole('region', { name: 'Réglés dans d’autres écrans' });
    expect(
      within(section).getByRole('heading', { name: 'Les premiers mails et relances à froid' }),
    ).toBeTruthy();
    expect(
      within(section).getByRole('heading', { name: 'La recherche quotidienne de suspects' }),
    ).toBeTruthy();
    expect(within(section).getByRole('heading', { name: 'L’alerte du BODACC' })).toBeTruthy();
    expect(within(section).getByText('Activé, chaque jour à 10:00')).toBeTruthy();
    expect(within(section).getByText('En pause')).toBeTruthy();
    expect(within(section).getByText(/Dernier passage : 11\/11\/2026\. 5 brouillons/)).toBeTruthy();
    const regler = within(section).getAllByRole('link', { name: 'Régler' });
    expect(regler.map((l) => l.getAttribute('href'))).toEqual([
      '#/simatis/bases/ouvrir/routine-recherche',
      '#/simatis/bases/ouvrir/routine-recherche',
      '#/simatis/bases/ouvrir/alerte',
    ]);
  });

  it('ne montre que ce qui se lit, sans casser la page quand un réglage est indisponible', async () => {
    repondre({ '/base/signaux/routine': { active: true, heure: '08:00' } });
    render(<AutresAutomatismes slug="simatis" />);
    expect(await screen.findByRole('heading', { name: 'L’alerte du BODACC' })).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'La recherche quotidienne de suspects' }),
    ).toBeNull();
  });

  it('n’affiche rien quand aucun des trois ne se lit', async () => {
    repondre({});
    const { container } = render(<AutresAutomatismes slug="simatis" />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.firstChild).toBeNull();
  });
});
