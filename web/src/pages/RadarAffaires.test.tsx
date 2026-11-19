// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
                      etape: 'lead',
                      tentatives: 3,
                      radar: 'sans_reponse',
                      radarEtapeManuelle: null,
                      canalRadar: 'Téléphone',
                      origineCommerciale: 'LinkedIn',
                    },
                    { id: 'b', titre: 'Mission qualifiée', etape: 'qualification', radar: null },
                  ],
                  etapes: [
                    { id: 'cible', label: 'Cible' },
                    { id: 'lead', label: 'Lead identifié' },
                    { id: 'qualification', label: 'Qualification' },
                  ],
                  contactsARattacher: [
                    {
                      id: 'base-a',
                      entreprise: 'Société Démo',
                      nom: 'Contact Fictif',
                      linkedin: 'https://linkedin.com/in/fictif',
                      provenance: 'Recherche',
                      statut: 'a_repondu',
                    },
                  ],
                }
              : url.endsWith('/rendez-vous')
                ? {
                    etat: 'ok',
                    rdv: [
                      {
                        id: 'rdv-fictif',
                        titre: 'RDV Société Démo',
                        debut: '2026-11-20T15:00:00Z',
                        statut: 'rdv',
                        opportunite: null,
                      },
                    ],
                  }
                : { etat: 'termine' },
          ),
        ),
      ),
    ),
  );
  render(<RadarAffaires slug="demo" />);
  const point = await screen.findByRole('button', { name: 'Aperçu de Mission fictive' });
  fireEvent.mouseEnter(point);
  expect(within(screen.getByRole('tooltip')).getByText('Origine · LinkedIn')).toBeTruthy();
  fireEvent.click(point);
  fireEvent.mouseLeave(point.closest('.ra-plot')!);
  expect(screen.getByRole('link', { name: 'Ouvrir la fiche affaire' }).getAttribute('href')).toBe(
    '#/demo/fiche/affaire/a?depuis=radar',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Vue pipe' }));
  expect(screen.getByRole('button', { name: 'Vue pipe' }).classList.contains('on')).toBe(true);
  expect(screen.getByRole('region', { name: 'Ont répondu' })).toBeTruthy();
  const affaire = screen.getByRole('button', { name: /Mission fictive/ });
  fireEvent.click(affaire);
  expect(screen.getByRole('link', { name: 'Ouvrir la fiche affaire' }).getAttribute('href')).toBe(
    '#/demo/fiche/affaire/a?depuis=radar',
  );
  fireEvent.change(screen.getByLabelText('Déplacer Mission fictive'), {
    target: { value: '1' },
  });
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/i/demo/fiches/affaire/a',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ radarEtapeManuelle: 1 }) }),
    ),
  );
  const donnees = new Map<string, string>();
  const transfert = {
    types: [] as string[],
    setData(type: string, valeur: string) {
      donnees.set(type, valeur);
      this.types = [...donnees.keys()];
    },
    getData(type: string) {
      return donnees.get(type) ?? '';
    },
  };
  fireEvent.dragStart(screen.getByRole('button', { name: /Mission fictive/ }), {
    dataTransfer: transfert,
  });
  fireEvent.dragOver(screen.getByRole('region', { name: 'Ont répondu' }), {
    dataTransfer: transfert,
  });
  fireEvent.drop(screen.getByRole('region', { name: 'Ont répondu' }), {
    dataTransfer: transfert,
  });
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/i/demo/fiches/affaire/a',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ radarEtapeManuelle: 3 }) }),
    ),
  );
  expect(screen.queryByText('Mission qualifiée')).toBeNull();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher dans le Radar' }), {
    target: { value: 'societe demo' },
  });
  expect(screen.getByRole('link', { name: /Société Démo/ }).getAttribute('href')).toContain(
    'rechercher-Soci%C3%A9t%C3%A9%20D%C3%A9mo',
  );
  expect(screen.getByText(/Profil LinkedIn disponible/)).toBeTruthy();
  expect((await screen.findByRole('link', { name: /RDV à rattacher/ })).getAttribute('href')).toBe(
    '#/demo/fiche/rdv/rdv-fictif',
  );
});
