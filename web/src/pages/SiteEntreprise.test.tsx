// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntrepriseBaseWeb } from '../api.js';
import { SiteEntreprise } from './SiteEntreprise.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const vierge = {
  id: 'e1',
  siren: '123456789',
  nom: 'EXEMPLE',
  naf: null,
  categorie: null,
  effectif: null,
  adresse: null,
  ville: null,
  active: true,
  formeJuridique: null,
  creeLe: null,
  oppositionDiffusion: false,
  etablissementsOuverts: null,
  finances: [],
  dirigeants: [],
  siteWeb: null,
  siteTelephones: [],
  siteEmails: [],
  linkedin: null,
  siteConfirme: false,
  siteLuLe: null,
} as EntrepriseBaseWeb;

const lu = {
  ...vierge,
  siteWeb: 'https://www.exemple.test/',
  siteTelephones: ['+33437250573', '+33478001122'],
  siteEmails: ['contact@exemple.test'],
  linkedin: 'https://www.linkedin.com/company/exemple',
  siteConfirme: true,
  siteLuLe: '2026-11-09T10:00:00Z',
} as EntrepriseBaseWeb;

type Appel = { url: string; body: unknown };
function simuler(reponse: unknown, statut = 200) {
  const appels: Appel[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { body?: string }) => {
      appels.push({ url, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
      return Promise.resolve(new Response(JSON.stringify(reponse), { status: statut }));
    }),
  );
  return appels;
}

describe('Site web de l’entreprise', () => {
  it('dit que le site n’a pas été lu, et le lit à la demande', async () => {
    const appels = simuler(lu);
    const onLu = vi.fn();
    render(<SiteEntreprise slug="base" entreprise={vierge} onLu={onLu} />);
    expect(screen.getByText('Site non lu.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lire le site' }));
    await waitFor(() => expect(onLu).toHaveBeenCalledWith(lu));
    expect(appels[0]).toEqual({ url: '/api/i/base/base/entreprises/e1/site', body: {} });
  });

  it('envoie l’adresse saisie', async () => {
    const appels = simuler(lu);
    render(<SiteEntreprise slug="base" entreprise={vierge} onLu={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Adresse du site/), {
      target: { value: ' exemple.test ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lire le site' }));
    await waitFor(() => expect(appels[0]?.body).toEqual({ url: 'exemple.test' }));
  });

  it('montre le site, le standard, l’e-mail général et la page LinkedIn, avec la confirmation', () => {
    render(<SiteEntreprise slug="base" entreprise={lu} onLu={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'exemple.test' }).getAttribute('href')).toBe(
      'https://www.exemple.test/',
    );
    expect(screen.getByText('confirmé par son SIREN')).toBeTruthy();
    expect(screen.getByRole('link', { name: '04 37 25 05 73' }).getAttribute('href')).toBe(
      'tel:+33437250573',
    );
    expect(screen.getByText('04 78 00 11 22')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'contact@exemple.test' }).getAttribute('href')).toBe(
      'mailto:contact@exemple.test',
    );
    expect(screen.getByRole('link', { name: 'Page de l’entreprise' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Relire le site' })).toBeTruthy();
    expect(screen.getByText(/Lu le 09\/11\/2026/)).toBeTruthy();
  });

  it('prévient quand le site n’a pas pu être confirmé', () => {
    render(
      <SiteEntreprise slug="base" entreprise={{ ...lu, siteConfirme: false }} onLu={vi.fn()} />,
    );
    expect(screen.getByText('non confirmé : à vérifier')).toBeTruthy();
  });

  it('affiche l’erreur du serveur sans rien changer', async () => {
    simuler({ error: 'Aucun site connu pour cette entreprise : saisissez son adresse.' }, 400);
    const onLu = vi.fn();
    render(<SiteEntreprise slug="base" entreprise={vierge} onLu={onLu} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lire le site' }));
    expect(await screen.findByText(/saisissez son adresse/)).toBeTruthy();
    expect(onLu).not.toHaveBeenCalled();
  });
});
