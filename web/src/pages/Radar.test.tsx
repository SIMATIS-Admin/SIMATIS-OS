// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EtatRadar } from '../api.js';
import { Radar } from './Radar.js';

const fiche = (id: string, entreprise: string, nom: string) => ({
  id,
  entreprise,
  nom,
  fonction: null,
  nbContacts: 2,
  dernierContactLe: null,
  tags: [] as string[],
  prochaineRelanceLe: null as string | null,
});
const radar: EtatRadar = {
  aEnrichir: { total: 14, fiches: [fiche('a1', 'Atelier Fictif', '')] },
  prets: {
    total: 48,
    fiches: [
      { ...fiche('p1', 'Industrie Fictive', 'Paul Dumont'), tags: ['icp a (simatis)', 'salon'] },
    ],
  },
  contactes: {
    total: 63,
    fiches: [
      {
        ...fiche('c1', 'Usinage Fictif', 'Anne Leroux'),
        prochaineRelanceLe: '2020-01-01T00:00:00Z',
      },
      {
        ...fiche('c2', 'Fonderie Fictive', 'Luc Perrin'),
        prochaineRelanceLe: '2099-03-17T08:00:00Z',
      },
    ],
  },
  ontRepondu: { total: 0, fiches: [] },
  reprise: {
    contactes: {
      total: 42,
      fiches: [
        { id: 'x1', titre: 'Audit fictif', entreprise: 'Fonderie Fictive', contact: 'Jean Fictif' },
      ],
    },
    ontRepondu: {
      total: 1,
      fiches: [
        {
          id: 'x2',
          titre: 'Mission fictive',
          entreprise: 'Atelier Fictif',
          contact: 'Léa Fictive',
        },
      ],
    },
  },
  rdvAccepte: {
    total: 1,
    fiches: [
      {
        id: 'r1',
        nom: 'Alice Fictive',
        entreprise: 'Bureau Fictif',
        fonction: null,
        oppsOuvertes: 0,
      },
      {
        id: 'r2',
        nom: 'Bruno Fictif',
        entreprise: 'Usine Fictive',
        fonction: null,
        oppsOuvertes: 1,
      },
    ],
  },
};

describe('Radar', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('montre les cinq étapes avec leurs compteurs et leurs premières fiches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    const prets = await screen.findByRole('region', { name: 'Prêts à contacter' });
    expect(within(prets).getByText('48')).toBeTruthy();
    expect(within(prets).getByText('Paul Dumont')).toBeTruthy();
    expect(within(prets).getByText('+ 47 autres')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'À enrichir' })).getByText('14')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Contactés' })).getByText('105')).toBeTruthy();
    const reponses = screen.getByRole('region', { name: 'Ont répondu' });
    expect(within(reponses).getByText('Léa Fictive')).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'RDV accepté' })).getByText('Alice Fictive'),
    ).toBeTruthy();
  });

  it('ouvre la fiche du prospect, avec ses affaires, depuis la colonne RDV accepté', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    const colonne = await screen.findByRole('region', { name: 'RDV accepté' });
    const carte = within(colonne).getByRole('link', { name: /Alice Fictive/ });
    expect(carte.getAttribute('href')).toBe('#/simatis/fiche/contact/r1');
    // Les fiches de la base vivante n'ont pas de fiche CRM : leurs cartes ne sont pas des liens.
    const prets = screen.getByRole('region', { name: 'Prêts à contacter' });
    expect(within(prets).queryByRole('link', { name: /Paul Dumont/ })).toBeNull();
  });

  it('reprend dans Contactés les affaires du Pipeline écrites sans réponse, avec un lien vers leur fiche', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    const colonne = await screen.findByRole('region', { name: 'Contactés' });
    expect(
      within(colonne).getByText(
        /dont 42 affaires du Pipeline sans rendez-vous approchées sans réponse/,
      ),
    ).toBeTruthy();
    const carte = within(colonne).getByRole('link', { name: /Jean Fictif/ });
    expect(carte.getAttribute('href')).toBe('#/simatis/fiche/affaire/x1');
    expect(within(colonne).getByText('Fonderie Fictive · affaire Audit fictif')).toBeTruthy();
    // Les cartes de la base suivent, sans lien.
    expect(within(colonne).getByText('Anne Leroux')).toBeTruthy();
  });

  it('reprend dans Ont répondu les affaires du Pipeline dont le contact a répondu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    const colonne = await screen.findByRole('region', { name: 'Ont répondu' });
    expect(within(colonne).getByText('1')).toBeTruthy();
    expect(
      within(colonne)
        .getByRole('link', { name: /Léa Fictive/ })
        .getAttribute('href'),
    ).toBe('#/simatis/fiche/affaire/x2');
  });

  it('demande la lecture de la messagerie à l’ouverture, et la relance à la demande', async () => {
    const appels: { url: string; method?: string; body?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: { method?: string; body?: string }) => {
        appels.push({ url, method: init?.method, body: init?.body });
        return Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith('pipeline/echanges')
                ? { etat: 'termine', derniereLecture: '2026-11-14T08:12:00.000Z' }
                : radar,
            ),
          ),
        );
      }),
    );
    render(<Radar slug="simatis" />);
    expect(await screen.findByText(/Messagerie lue le 14 nov\. à 09:12/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Relire la messagerie' }));
    await waitFor(() =>
      expect(appels.filter((a) => a.url.endsWith('pipeline/echanges')).map((a) => a.body)).toEqual([
        JSON.stringify({ force: false }),
        JSON.stringify({ force: true }),
      ]),
    );
  });

  it("montre l'ICP d'où vient une fiche, et seulement lui parmi ses étiquettes", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    const prets = await screen.findByRole('region', { name: 'Prêts à contacter' });
    expect(within(prets).getByText('ICP A (SIMATIS)')).toBeTruthy();
    expect(within(prets).queryByText(/salon/i)).toBeNull();
  });

  it('indique la prochaine relance de chaque contact de la séquence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    const colonne = await screen.findByRole('region', { name: 'Contactés' });
    expect(within(colonne).getByText(/Usinage Fictif · 2 touches · relance possible/)).toBeTruthy();
    expect(
      within(colonne).getByText(/Fonderie Fictive · 2 touches · relance le 17 mars/),
    ).toBeTruthy();
  });

  it("propose de créer l'affaire d'un prospect qui n'en a pas, et crée sans doublonner", async () => {
    const appels: { url: string; method?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: { method?: string }) => {
        appels.push({ url, method: init?.method });
        return Promise.resolve(
          new Response(JSON.stringify(init?.method === 'POST' ? { id: 'aff-1' } : radar)),
        );
      }),
    );
    render(<Radar slug="simatis" />);
    const colonne = await screen.findByRole('region', { name: 'RDV accepté' });
    // Alice n'a pas d'affaire : bouton. Bruno en a une : pas de bouton.
    const boutons = within(colonne).getAllByRole('button', { name: 'Créer l’affaire' });
    expect(boutons).toHaveLength(1);
    expect(within(colonne).getByRole('link', { name: /Bruno Fictif/ })).toBeTruthy();
    fireEvent.click(boutons[0]!);
    expect(await screen.findByText('Affaire créée à la première étape du Pipeline.')).toBeTruthy();
    expect(appels.some((c) => c.method === 'POST' && c.url.endsWith('/contacts/r1/affaire'))).toBe(
      true,
    );
  });

  it("dit clairement quand l'écriture réelle est fermée et que rien n'a été créé", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: { method?: string }) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              init?.method === 'POST'
                ? { simulation: true, message: 'Simulation : écriture HubSpot fermée.' }
                : radar,
            ),
          ),
        ),
      ),
    );
    render(<Radar slug="simatis" />);
    const colonne = await screen.findByRole('region', { name: 'RDV accepté' });
    fireEvent.click(within(colonne).getByRole('button', { name: 'Créer l’affaire' }));
    expect(await screen.findByText('Simulation : écriture HubSpot fermée.')).toBeTruthy();
  });

  it('ne garde que le suivi : ni recherche ni réglage de séquence, et un lien vers la base', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    await screen.findByRole('region', { name: 'Contactés' });
    expect(screen.getByRole('link', { name: 'Voir la base' }).getAttribute('href')).toBe(
      '#/simatis/bases',
    );
    expect(screen.queryByRole('region', { name: 'Chercher selon ma stratégie' })).toBeNull();
    expect(screen.queryByText(/séquence/i)).toBeNull();
  });

  it('offre une action par colonne, qui ouvre le bon écran déjà préparé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    const lien = async (colonne: string, nom: string | RegExp) =>
      within(await screen.findByRole('region', { name: colonne }))
        .getByRole('link', { name: nom })
        .getAttribute('href');
    expect(await lien('À enrichir', 'Enrichir les 14')).toBe('#/simatis/bases/ouvrir/a-enrichir');
    expect(await lien('Prêts à contacter', 'Écrire aux 48')).toBe(
      '#/simatis/prospection/ouvrir/froid',
    );
    expect(await lien('Contactés', 'Relancer')).toBe('#/simatis/prospection/ouvrir/froid');
    expect(await lien('Ont répondu', /Répondre/)).toBe('#/simatis/cockpit');
    expect(await lien('RDV accepté', /Pipeline/)).toBe('#/simatis/pipeline');
  });

  it("explique l'échec de chargement", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    );
    render(<Radar slug="simatis" />);
    expect(await screen.findByText(/500|boom|Erreur/i)).toBeTruthy();
  });
});
