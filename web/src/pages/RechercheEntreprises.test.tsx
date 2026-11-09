// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RechercheEntreprises } from './RechercheEntreprises.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Appel = { url: string; body: unknown };
const resultat = (siren: string, nom: string) => ({
  siren,
  nom,
  naf: '25.62B',
  categorie: 'PME',
  effectif: '20 à 49 salariés',
  adresse: null,
  ville: 'CHASSIEU',
  active: true,
  finances: [{ annee: 2023, ca: 425000, resultat: 9000 }],
});

function simuler(reponses: Record<string, { status?: number; corps: unknown }>) {
  const appels: Appel[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { body?: string }) => {
      appels.push({ url, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
      const cle = Object.keys(reponses).find((c) => url.endsWith(c));
      const r = cle ? reponses[cle] : { status: 404, corps: {} };
      return Promise.resolve(new Response(JSON.stringify(r?.corps), { status: r?.status ?? 200 }));
    }),
  );
  return appels;
}

const listes = [{ id: 'l1', nom: 'Industrie Rhône', mandat: null, nombre: 0 }];

describe('Chercher des entreprises', () => {
  it('comprend la demande, cherche, et ajoute les entreprises choisies à une liste', async () => {
    const appels = simuler({
      '/entreprises/interpreter': {
        corps: {
          resume: 'PME de la métallurgie dans le Rhône',
          nonTraites: ['sans directeur commercial'],
          criteres: {
            secteurs: [{ code: '25', libelle: 'Produits métalliques' }],
            departements: ['69'],
            effectifs: ['11', '12'],
            categories: ['PME'],
          },
        },
      },
      '/entreprises/recherche': {
        corps: {
          resultats: [
            resultat('123456789', 'ATELIER FICTIF'),
            resultat('222222222', 'BUREAU FICTIF'),
          ],
          total: 2,
          pages: 1,
          page: 1,
          dejaDansLaBase: ['222222222'],
        },
      },
      '/entreprises/ajouter': { corps: { ajoutees: 1, existantes: 0, introuvables: 0 } },
    });
    const onAjoute = vi.fn();
    render(<RechercheEntreprises slug="base" listes={listes} onAjoute={onAjoute} />);
    fireEvent.change(screen.getByLabelText(/Les entreprises que vous cherchez/), {
      target: { value: 'PME métallurgie Rhône sans directeur commercial' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Comprendre ma demande' }));
    expect(await screen.findByText(/PME de la métallurgie dans le Rhône/)).toBeTruthy();
    expect(screen.getByText(/ne permet pas de filtrer : sans directeur commercial/)).toBeTruthy();
    expect(screen.getByText(/Produits métalliques \(25\)/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Départements').value).toBe('69');
    expect(screen.getByLabelText<HTMLInputElement>('PME').checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Chercher dans l’annuaire' }));
    expect(await screen.findByText('ATELIER FICTIF')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Choisir BUREAU FICTIF').disabled).toBe(true);
    expect(screen.getByText(/déjà dans la base/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Choisir ATELIER FICTIF'));
    fireEvent.change(screen.getByLabelText('Ranger dans une liste'), { target: { value: 'l1' } });
    fireEvent.click(screen.getByRole('button', { name: /Ajouter 1 entreprise à la base/ }));
    await waitFor(() =>
      expect(onAjoute).toHaveBeenCalledWith('Entreprises : 1 ajoutée à enrichir.'),
    );
    expect(appels.at(-1)).toMatchObject({
      url: '/api/i/base/base/entreprises/ajouter',
      body: { sirens: ['123456789'], liste: 'l1' },
    });
    const recherche = appels.find((a) => a.url.endsWith('/entreprises/recherche'));
    expect(recherche?.body).toMatchObject({
      criteres: { departements: ['69'], effectifs: ['11', '12'] },
      page: 1,
    });
  });

  it('permet de saisir les critères à la main quand aucune IA n’est disponible', async () => {
    const appels = simuler({
      '/entreprises/interpreter': {
        status: 409,
        corps: { error: 'Aucune IA n’est disponible : renseignez les critères à la main.' },
      },
      '/entreprises/recherche': {
        corps: { resultats: [], total: 0, pages: 1, page: 1, dejaDansLaBase: [] },
      },
    });
    render(<RechercheEntreprises slug="base" listes={[]} onAjoute={vi.fn()} />);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Chercher dans l’annuaire' }).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText(/Les entreprises que vous cherchez/), {
      target: { value: 'PME' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Comprendre ma demande' }));
    expect((await screen.findByRole('alert')).textContent).toContain('à la main');

    const secteur = screen.getByLabelText(/Ajouter un secteur/);
    fireEvent.change(secteur, { target: { value: '25.62b' } });
    fireEvent.keyDown(secteur, { key: 'Enter' });
    expect(screen.getByText(/NAF 25\.62B/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Départements'), { target: { value: '69, 01' } });
    fireEvent.click(screen.getByLabelText('10 à 49'));
    fireEvent.click(screen.getByRole('button', { name: 'Chercher dans l’annuaire' }));
    expect(await screen.findByText(/Aucune entreprise ne correspond/)).toBeTruthy();
    expect(appels.at(-1)?.body).toMatchObject({
      criteres: {
        secteurs: [{ code: '25.62B' }],
        departements: ['69', '01'],
        effectifs: ['11', '12'],
      },
    });
  });

  it('passe d’une page à l’autre', async () => {
    const appels = simuler({
      '/entreprises/recherche': {
        corps: {
          resultats: [resultat('123456789', 'ATELIER FICTIF')],
          total: 60,
          pages: 3,
          page: 1,
          dejaDansLaBase: [],
        },
      },
    });
    render(<RechercheEntreprises slug="base" listes={[]} onAjoute={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('PME'));
    fireEvent.click(screen.getByRole('button', { name: 'Chercher dans l’annuaire' }));
    await screen.findByText(/page 1 sur 3/);
    fireEvent.click(screen.getByRole('button', { name: 'Page suivante' }));
    await waitFor(() => expect(appels.at(-1)?.body).toMatchObject({ page: 2 }));
  });
});
