// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agenda } from './Agenda.js';

// The tasks are checked on their own (their own tests cover them); the meetings come from a fake list.
vi.mock('./Taches.js', () => ({ Taches: () => <div>Tâches fictives</div> }));
vi.mock('../api.js', () => ({
  fetchRendezVous: () =>
    Promise.resolve({
      etat: 'ok',
      rdv: [
        {
          id: 'evt-1',
          debut: '2026-10-20T08:00:00Z',
          fin: '2026-10-20T09:00:00Z',
          titre: 'Point projet fictif',
          lieu: null,
          contact: { id: 'c1', nom: 'Contact fictif', entreprise: null },
          opportunite: null,
          compteRendu: false,
        },
      ],
      agendasIgnores: [],
    }),
}));

describe('Agenda', () => {
  afterEach(cleanup);

  it('shows the meetings above the tasks, each linked to its row in Rendez-vous', async () => {
    render(<Agenda slug="simatis" />);
    expect(await screen.findByText('Point projet fictif')).toBeTruthy();
    expect(screen.getByText('Tâches fictives')).toBeTruthy();
    const lien = screen.getByRole('link', { name: 'Ouvrir dans Rendez-vous' });
    expect(lien.getAttribute('href')).toBe('#/simatis/rendez-vous/ouvrir/evt-1');
  });

  it('shows only the tasks or only the meetings when asked', async () => {
    render(<Agenda slug="simatis" />);
    await screen.findByText('Point projet fictif');
    fireEvent.click(screen.getByRole('button', { name: 'Tâches' }));
    await waitFor(() => expect(screen.queryByText('Point projet fictif')).toBeNull());
    expect(screen.getByText('Tâches fictives')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rendez-vous' }));
    expect(await screen.findByText('Point projet fictif')).toBeTruthy();
    expect(screen.queryByText('Tâches fictives')).toBeNull();
  });
});
