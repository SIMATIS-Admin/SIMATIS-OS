// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contact, FicheDetail, SemaineTaches } from '../../api.js';
import { Entreprises } from '../Entreprises.js';
import { Contacts } from '../Contacts.js';
import { Fiche } from '../Fiche.js';
import { ApercuCommercial } from './Apercu.js';
import { JourneeCommerciale } from './Journee.js';
import { OutilsConnexes } from './OutilsConnexes.js';

const contact: FicheDetail = {
  kind: 'contact',
  fiche: { id: 'c1', nom: 'Claire Exemple', fonction: 'Dirigeante', origine: 'os' },
  liens: { entreprise: { id: 'e1', nom: 'Entreprise Fictive' }, affaires: [] },
  aVenir: [],
  rendezVous: [],
  historique: [
    {
      id: 'n1',
      type: 'note',
      titre: null,
      texte: 'Note fictive de qualification',
      at: '2026-11-01T10:00:00Z',
      origine: 'os',
    },
    {
      id: 'm1',
      type: 'email',
      titre: 'Message fictif',
      texte: 'Confirmation du créneau',
      at: '2026-11-02T10:00:00Z',
      origine: 'os',
    },
  ],
  ecrit: true,
  testsVma: [{ id: 'v1', nom: 'Test individuel fictif', date: '2026-11-02T10:00:00Z' }],
  diagnostics: [],
};
const entreprise: FicheDetail = {
  ...contact,
  kind: 'entreprise',
  fiche: { id: 'e1', nom: 'Entreprise Fictive', origine: 'os' },
  liens: { contacts: [{ id: 'c1', nom: 'Claire Exemple', principal: true }], affaires: [] },
  testsVma: [],
  diagnostics: [{ id: 'd1', nom: 'Diagnostic fictif', etape: 3, statut: 'en cours', date: null }],
};
const contacts: Contact[] = [
  {
    id: 'c1',
    nom: 'Claire Exemple',
    fonction: 'Dirigeante',
    email: null,
    telephone: null,
    role: null,
    entreprise: 'Entreprise Fictive',
    entrepriseId: 'e1',
    oppsOuvertes: 1,
    prochaineActivite: '2026-11-05T10:00:00Z',
  },
  {
    id: 'c2',
    nom: 'Paul Démonstration',
    fonction: 'Commercial',
    email: null,
    telephone: null,
    role: null,
    entreprise: null,
    entrepriseId: null,
    oppsOuvertes: 0,
    prochaineActivite: null,
  },
];
const reponse = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
const fakeFetch = (url: string) => {
  if (url.endsWith('/mails')) return reponse({ mails: [], adresses: 0 });
  if (url.includes('/fiches/contact/')) return reponse(contact);
  if (url.includes('/fiches/entreprise/')) return reponse(entreprise);
  if (url.includes('/contacts?q=')) return reponse(contacts);
  return reponse([]);
};

describe('Parcours commerciaux', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('ouvre les entreprises en liste et isole celles sans contact', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('/entreprises?q=')
          ? reponse([
              {
                id: 'e1',
                nom: 'Société exemple',
                nbContacts: 1,
                oppsOuvertes: 0,
                montantOuvert: 0,
                montantMensuelOuvert: 0,
              },
              {
                id: 'e3',
                nom: 'Entreprise HubSpot 12345',
                nbContacts: 1,
                oppsOuvertes: 0,
                montantOuvert: 0,
                montantMensuelOuvert: 0,
              },
              {
                id: 'e2',
                nom: 'Société sans interlocuteur',
                nbContacts: 0,
                oppsOuvertes: 0,
                montantOuvert: 0,
                montantMensuelOuvert: 0,
              },
            ])
          : reponse([]),
      ),
    );
    render(<Entreprises slug="test" />);
    await screen.findByText('Société exemple');
    expect(screen.getByRole('button', { name: 'Liste' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Sans contact' }));
    expect(screen.queryByText('Société exemple')).toBeNull();
    expect(screen.getByText('Société sans interlocuteur')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Nom à renseigner' }));
    expect(screen.getByText('Entreprise HubSpot 12345')).toBeTruthy();
    expect(screen.queryByText('Société sans interlocuteur')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cartes' }));
    expect(screen.getByRole('button', { name: 'Cartes' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('filtre les contacts, conserve la recherche et ouvre un aperçu au clavier', async () => {
    const vue = render(<Contacts slug="test" />);
    await screen.findByText('Claire Exemple');
    fireEvent.click(screen.getByRole('button', { name: 'Sans activité' }));
    expect(screen.queryByText('Claire Exemple')).toBeNull();
    expect(screen.getByText('Paul Démonstration')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Avec une affaire' }));
    expect(screen.getByText('Claire Exemple')).toBeTruthy();
    expect(screen.queryByText('Paul Démonstration')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Claire Exemple Dirigeante/ }));
    expect(await screen.findByRole('dialog', { name: 'Claire Exemple' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Ouvrir la fiche complète' }).getAttribute('href'),
    ).toBe('#/test/fiche/contact/c1');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'Claire' } });
    await waitFor(() =>
      expect(sessionStorage.getItem('simatis.commercial.test.contacts.recherche')).toBe('Claire'),
    );
    vue.unmount();
    render(<Contacts slug="test" />);
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('Claire');
  });

  it('passe du contact à son entreprise sans modifier l’URL ni perdre le retour', async () => {
    location.hash = '#/test/contacts';
    render(
      <ApercuCommercial
        slug="test"
        reference={{ kind: 'contact', id: 'c1' }}
        onFermer={() => undefined}
      />,
    );
    await screen.findByRole('dialog', { name: 'Claire Exemple' });
    const lien = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Entreprise Fictive',
    });
    fireEvent.click(lien);
    expect(await screen.findByRole('dialog', { name: 'Entreprise Fictive' })).toBeTruthy();
    expect(location.hash).toBe('#/test/contacts');
    fireEvent.click(screen.getByRole('button', { name: /Fiche précédente/ }));
    expect(await screen.findByRole('dialog', { name: 'Claire Exemple' })).toBeTruthy();
  });

  it('garde accessibles le résultat VMA du contact et le diagnostic de son entreprise', async () => {
    render(
      <ApercuCommercial
        slug="test"
        reference={{ kind: 'contact', id: 'c1' }}
        onFermer={() => undefined}
      />,
    );
    const diagnostic = await screen.findByRole('link', { name: /Diagnostic fictif/ });
    expect(diagnostic.getAttribute('href')).toBe('#/test/diagnostics/ouvrir/d1');
    expect(screen.getByRole('link', { name: /Test individuel fictif/ }).getAttribute('href')).toBe(
      '#/test/diagnostics/test/v1',
    );
    expect(screen.getByText('Via Entreprise Fictive')).toBeTruthy();
  });

  it('signale un échec de lecture sans envoyer d’écriture', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('indisponible', { status: 503 }))),
    );
    render(
      <ApercuCommercial
        slug="test"
        reference={{ kind: 'contact', id: 'c1' }}
        onFermer={() => undefined}
      />,
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ouvrir la fiche complète' })).toBeTruthy();
    expect(
      vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET'),
    ).toBe(true);
  });

  it('les liens indirects sont dédupliqués et consultables sans bouton de déliaison', async () => {
    render(
      <OutilsConnexes
        slug="test"
        fiche={{ ...contact, diagnostics: entreprise.diagnostics }}
        inclureDirect={false}
        references={[
          { kind: 'entreprise', id: 'e1' },
          { kind: 'entreprise', id: 'e1' },
        ]}
      />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('link', { name: /Diagnostic fictif/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Délier/ })).toBeNull();
  });

  it('isole les mails dans la fiche complète et conserve la gestion des liens', async () => {
    const { container } = render(<Fiche slug="test" kind="contact" id="c1" />);
    await screen.findByRole('heading', { name: 'Claire Exemple' });
    expect(screen.getByText('Note fictive de qualification')).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Rubriques de la fiche' })).getByRole(
        'button',
        { name: 'Mails' },
      ),
    );
    expect(screen.getByRole('heading', { name: 'Conversations mail' })).toBeTruthy();
    expect(screen.getByText('Confirmation du créneau')).toBeTruthy();
    expect(screen.queryByText('Note fictive de qualification')).toBeNull();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Rubriques de la fiche' })).getByRole(
        'button',
        { name: 'Liens' },
      ),
    );
    expect(container.querySelector('.commercial-fiche')?.getAttribute('data-rubrique')).toBe(
      'liens',
    );
    expect(screen.getByRole('button', { name: 'Lier un test VMA' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lier un diagnostic' })).toBeTruthy();
  });
});

it('le planning du jour respecte les événements couvrant plusieurs jours et ouvre le bon rendez-vous', () => {
  const onRdv = vi.fn();
  const data: SemaineTaches = {
    taches: [],
    enRetard: [],
    sansEcheance: [],
    instances: [],
    ecrit: true,
    hubspot: false,
    rdvEtat: 'ok',
    rdv: [
      {
        id: 'bloc:1',
        titre: 'Événement fictif',
        debut: '2026-11-04T00:00:00+01:00',
        fin: '2026-11-07T00:00:00+01:00',
        journee: true,
        lieu: null,
        agenda: 'Démonstration',
        couleur: null,
      },
      {
        id: 'point:1',
        titre: 'Point fictif',
        debut: '2026-11-05T10:00:00+01:00',
        fin: '2026-11-05T11:00:00+01:00',
        journee: false,
        lieu: null,
        agenda: 'Démonstration',
        couleur: null,
      },
      {
        id: 'autre',
        titre: 'Autre jour fictif',
        debut: '2026-11-06T10:00:00+01:00',
        fin: '2026-11-06T11:00:00+01:00',
        journee: false,
        lieu: null,
        agenda: 'Démonstration',
        couleur: null,
      },
    ],
  };
  const { unmount } = render(
    <JourneeCommerciale jour="2026-11-05" data={data} onRdv={onRdv} onTache={() => undefined} />,
  );
  expect(screen.getByText('Événement fictif')).toBeTruthy();
  expect(screen.queryByText('Autre jour fictif')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Point fictif/ }));
  expect(onRdv).toHaveBeenCalledWith('point:1');
  unmount();
});
