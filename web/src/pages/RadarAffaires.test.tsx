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
                      radarEtapesDates: {
                        0: '2026-11-01T09:00:00Z',
                        1: '2026-11-03T09:00:00Z',
                        2: '2026-11-06T09:00:00Z',
                      },
                      creeLe: '2026-11-01T09:00:00Z',
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
  expect(screen.queryByText('Parcourir les affaires')).toBeNull();
  expect(screen.getByLabelText(/À contacter vers Contactées : 100 %/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Canal de Mission fictive'), {
    target: { value: 'LinkedIn' },
  });
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/i/demo/fiches/affaire/a',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ radarCanalManuel: 'LinkedIn' }),
      }),
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
  fireEvent.click(screen.getByRole('button', { name: 'Vue liste' }));
  expect(screen.getByRole('button', { name: 'Vue liste' }).classList.contains('on')).toBe(true);
  fireEvent.change(screen.getByLabelText('Étape Radar de Mission fictive'), {
    target: { value: '1' },
  });
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/i/demo/fiches/affaire/a',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ radarEtapeManuelle: 1 }) }),
    ),
  );
  const origine = screen.getByLabelText('Origine commerciale de Mission fictive');
  fireEvent.change(origine, { target: { value: 'Salon fictif' } });
  fireEvent.blur(origine);
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/i/demo/fiches/affaire/a',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ origineCommerciale: 'Salon fictif' }),
      }),
    ),
  );
  fireEvent.click(screen.getByLabelText('Sélectionner Mission fictive'));
  fireEvent.change(screen.getByLabelText('Canal à appliquer aux affaires sélectionnées'), {
    target: { value: 'E-mail' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/i/demo/fiches/affaire/a',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ radarCanalManuel: 'E-mail' }),
      }),
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

it('« Ajouter au Radar » ouvre le formulaire, propose les origines connues et recharge le Radar après un ajout', async () => {
  const pipeline = {
    opportunites: [
      {
        id: 'a',
        titre: 'Mission fictive',
        etape: 'lead',
        tentatives: 0,
        radar: null,
        radarEtapeManuelle: null,
        radarEtapesDates: {},
        origineCommerciale: 'Origine Test',
      },
    ],
    etapes: [
      { id: 'cible', label: 'Cible' },
      { id: 'lead', label: 'Lead identifié' },
    ],
    contactsARattacher: [],
  };
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          init?.method === 'POST'
            ? { id: 'n', contactId: 'c' }
            : url.endsWith('/pipeline')
              ? pipeline
              : url.includes('/contacts?')
                ? []
                : url.endsWith('/rendez-vous')
                  ? { etat: 'ok', rdv: [] }
                  : { etat: 'termine' },
        ),
        { status: init?.method === 'POST' ? 201 : 200 },
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<RadarAffaires slug="demo" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ajouter au Radar' }));
  const options = Array.from(document.querySelectorAll('datalist option')).map((o) =>
    o.getAttribute('value'),
  );
  expect(options).toEqual(['Origine Test']);
  const pipelinesAvant = fetchMock.mock.calls.filter(([u]) =>
    String(u).endsWith('/pipeline'),
  ).length;
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Fictive' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/pipeline')).length).toBe(
      pipelinesAvant + 1,
    ),
  );
  expect(screen.queryByRole('form', { name: 'Ajouter au Radar' })).toBeNull();
});
