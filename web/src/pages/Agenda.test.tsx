// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agenda } from './Agenda.js';

// The two parts are checked on their own (their own tests cover what they show).
vi.mock('./RendezVous.js', () => ({ RendezVous: () => <div>Rendez-vous fictifs</div> }));
vi.mock('./Taches.js', () => ({ Taches: () => <div>Tâches fictives</div> }));

describe('Agenda', () => {
  afterEach(cleanup);

  it('shows the meetings above the tasks by default', () => {
    render(<Agenda slug="simatis" />);
    expect(screen.getByText('Rendez-vous fictifs')).toBeTruthy();
    expect(screen.getByText('Tâches fictives')).toBeTruthy();
  });

  it('shows only the tasks or only the meetings when asked', () => {
    render(<Agenda slug="simatis" />);
    fireEvent.click(screen.getByRole('button', { name: 'Tâches' }));
    expect(screen.queryByText('Rendez-vous fictifs')).toBeNull();
    expect(screen.getByText('Tâches fictives')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rendez-vous' }));
    expect(screen.getByText('Rendez-vous fictifs')).toBeTruthy();
    expect(screen.queryByText('Tâches fictives')).toBeNull();
  });
});
