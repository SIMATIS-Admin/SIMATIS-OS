// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportWaalaxy } from './ExportWaalaxy.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const reponse = (corps: unknown) =>
  vi.fn<(url: string) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(corps))),
  );

describe('Export Waalaxy', () => {
  it('annonce les fiches retenues et écartées, et propose un téléchargement par fichier', async () => {
    const fetchSimule = reponse({
      retenues: 12_500,
      parties: 2,
      ecartees: { opposition: 3, exclusion: 1, sansProfil: 40, alerte: 2 },
      nonVerifiees: 6,
    });
    vi.stubGlobal('fetch', fetchSimule);
    render(<ExportWaalaxy slug="base" filtres={{ statut: 'jamais_contacte' }} />);
    expect(await screen.findByText(/12\s?500 contacts/)).toBeTruthy();
    expect(screen.getByText(/40 sans profil LinkedIn/)).toBeTruthy();
    expect(screen.getByText(/3 en opposition/)).toBeTruthy();
    expect(screen.getByText(/1 exclu/)).toBeTruthy();
    expect(screen.getByText(/2 en procédure ou radiation \(BODACC\)/)).toBeTruthy();
    expect(screen.getByText(/6 contacts d’entreprises jamais vérifiées au BODACC/)).toBeTruthy();
    const liens = screen.getAllByRole('link', { name: /Télécharger/ });
    expect(liens.map((l) => l.getAttribute('href'))).toEqual([
      '/api/i/base/base/export-waalaxy.csv?statut=jamais_contacte&partie=1',
      '/api/i/base/base/export-waalaxy.csv?statut=jamais_contacte&partie=2',
    ]);
    expect(fetchSimule.mock.calls[0]?.[0]).toContain('/base/export-waalaxy?statut=jamais_contacte');
  });

  it('ne propose rien à télécharger quand aucun contact n’a de profil LinkedIn', async () => {
    vi.stubGlobal(
      'fetch',
      reponse({
        retenues: 0,
        parties: 1,
        ecartees: { opposition: 0, exclusion: 0, sansProfil: 5, alerte: 0 },
        nonVerifiees: 0,
      }),
    );
    render(<ExportWaalaxy slug="base" filtres={{}} />);
    await waitFor(() => expect(screen.getByText(/Aucun contact/)).toBeTruthy());
    expect(screen.queryByRole('link', { name: /Télécharger/ })).toBeNull();
  });
});
