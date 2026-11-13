// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Brief as BriefData } from '../api.js';

const api = vi.hoisted(() => ({ fetchBrief: vi.fn(), fetchRadar: vi.fn() }));
vi.mock('../api.js', () => api);
vi.mock('./Prospection.js', () => ({ PanneauProspection: () => <p>Prospection du jour</p> }));

import { Brief } from './Brief.js';

const compte = (total: number) => ({ email: total, appel: 0, autre: 0, total });
const brief = (retard: number): BriefData => ({
  source: 'natif',
  aFaire: { retard, jour: compte(4) },
  rdv: [],
  rdvEtat: 'ok',
  realisees: {
    veille: { ...compte(0), jour: '2026-11-12' },
    semaine: compte(0),
    mois: compte(0),
    aujourdhui: compte(1),
  },
  rdvTenus: null,
});

describe('Brief', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('résume la journée en quatre tuiles, détails repliés', async () => {
    api.fetchBrief.mockResolvedValue(brief(2));
    api.fetchRadar.mockResolvedValue({ ontRepondu: { total: 3 } });
    render(<Brief slug="simatis" />);
    expect(await screen.findByText('Ont répondu')).toBeTruthy();
    const tuile = (nom: string) => screen.getByText(nom).closest('a')!;
    expect(tuile('Ont répondu').textContent).toContain('3');
    expect(tuile('Ont répondu').getAttribute('href')).toBe('#/simatis/radar');
    expect(tuile('Tâches en retard').textContent).toContain('2');
    expect(tuile('Tâches en retard').classList.contains('alerte')).toBe(true);
    expect(tuile('Tâches du jour').textContent).toContain('4');
    // Les détails sont repliés : un clic les ouvre, ils n'allongent pas la page.
    const details = document.querySelectorAll('details');
    expect(details.length).toBeGreaterThan(0);
    details.forEach((d) => expect(d.open).toBe(false));
  });

  it('garde les autres tuiles quand le Radar ne répond pas', async () => {
    api.fetchBrief.mockResolvedValue(brief(0));
    api.fetchRadar.mockRejectedValue(new Error('hors ligne'));
    render(<Brief slug="simatis" />);
    expect(await screen.findByText('Tâches du jour')).toBeTruthy();
    expect(screen.queryByText('Ont répondu')).toBeNull();
    expect(screen.getByText('Tâches en retard').closest('a')!.classList.contains('alerte')).toBe(
      false,
    );
  });
});
