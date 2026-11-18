// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RadarAffaires } from './RadarAffaires.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('présente les mêmes affaires et les mêmes liens dans les deux vues', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/pipeline')
              ? {
                  opportunites: [
                    {
                      id: 'a',
                      titre: 'Mission fictive',
                      tentatives: 3,
                      radar: 'sans_reponse',
                      canalRadar: 'Téléphone',
                    },
                    { id: 'b', titre: 'Mission qualifiée', radar: null },
                  ],
                }
              : { etat: 'termine' },
          ),
        ),
      ),
    ),
  );
  render(<RadarAffaires slug="demo" />);
  const point = await screen.findByLabelText('Mission fictive');
  expect(point.getAttribute('href')).toBe('#/demo/fiche/affaire/a');
  fireEvent.click(screen.getByRole('button', { name: 'Vue pipe' }));
  expect(screen.getByRole('link', { name: /Mission fictive/ }).getAttribute('href')).toBe(
    point.getAttribute('href'),
  );
  expect(screen.queryByText('Mission qualifiée')).toBeNull();
});
