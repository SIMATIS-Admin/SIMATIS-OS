// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../api.js';
import { ContactsVma } from './ContactsVma.js';
vi.mock('../../api.js', async (original) => ({
  ...(await original<typeof import('../../api.js')>()),
  fetchContactsVma: vi.fn(),
  fetchContacts: vi.fn(),
  fetchEntreprises: vi.fn(),
  createContact: vi.fn(),
  createEntreprise: vi.fn(),
  rattacherVma: vi.fn(),
  creerLienProspectionVma: vi.fn(),
  retirerAccordVma: vi.fn(),
}));
const test = {
  id: 'test',
  entrepriseId: null,
  contactId: null,
  entrepriseNom: 'Entreprise fictive',
  contactPrenom: 'Camille',
  contactNomFamille: 'Exemple',
  contactNom: 'Camille Exemple',
  contactPoste: 'Direction',
  contactEmail: 'camille@exemple.test',
  contactTelephone: '0102030405',
  origine: 'inscription',
  statut: 'envoyee',
  expireLe: '2099-01-01T00:00:00Z',
  envoyeeLe: null,
  creeLe: '2026-11-02T10:00:00Z',
  recueLe: null,
  contactLie: null,
  entrepriseLiee: null,
  consentement: {
    accepteLe: '2026-11-02T10:00:00Z',
    version: '1',
    texte: 'Accord commercial fictif',
  },
} as api.ContactVma;
const mock = vi.mocked;
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mock(api.fetchContactsVma).mockResolvedValue([test]);
  mock(api.fetchContacts).mockResolvedValue([]);
  mock(api.fetchEntreprises).mockResolvedValue([]);
  mock(api.rattacherVma).mockResolvedValue({ ok: true });
});
describe('Page Contacts VMA', () => {
  it('regroupe les invitations au même nom complet et garde les deux entreprises', async () => {
    mock(api.fetchContactsVma).mockResolvedValue([
      test,
      {
        ...test,
        id: 'autre',
        contactPrenom: null,
        contactNomFamille: null,
        entrepriseNom: 'Autre entreprise',
        contactEmail: 'camille@autre.test',
      },
    ]);
    render(<ContactsVma slug="demo" onRetour={() => undefined} />);
    expect(await screen.findByText(/2 invitation/)).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Voir les 2 occurrences' }));
    expect(screen.getByText(/Autre entreprise ·/)).toBeTruthy();
    expect(screen.getAllByText('camille@autre.test').length).toBeGreaterThan(0);
  });

  it('affiche une seule fiche CRM et un accès par occurrence', async () => {
    const contactLie = { id: 'contact', nom: 'Camille Exemple' } as NonNullable<
      api.ContactVma['contactLie']
    >;
    mock(api.fetchContactsVma).mockResolvedValue([
      { ...test, contactLie },
      { ...test, id: 'archive', creeLe: '2026-11-01T10:00:00Z', contactLie },
    ]);
    const ouvrir = vi.fn();
    render(
      <ContactsVma
        slug="demo"
        onRetour={() => undefined}
        accesTest={(t) => ({ archive: t.id === 'archive', ouvrir })}
      />,
    );
    expect(await screen.findAllByRole('link', { name: 'Fiche CRM' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Rattacher au CRM' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Voir le test' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Voir dans les archives' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voir les 2 occurrences' }));
    expect(screen.getAllByRole('link', { name: 'Fiche CRM' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Voir dans les archives' }));
    expect(ouvrir).toHaveBeenCalledTimes(1);
  });

  it('sépare les anciens noms complets et combine recherche, filtre et tri', async () => {
    mock(api.fetchContactsVma).mockResolvedValue([
      test,
      {
        ...test,
        id: 'ancien',
        contactNom: 'Élodie Dubois',
        contactPrenom: null,
        contactNomFamille: null,
        origine: 'invitation',
      },
    ]);
    render(<ContactsVma slug="demo" onRetour={() => undefined} />);
    expect(await screen.findByText('Élodie')).toBeTruthy();
    expect(screen.getByText('Dubois')).toBeTruthy();
    const filtres = screen.getByRole('button', { name: 'Filtres et tri' });
    fireEvent.click(filtres);
    expect(filtres.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(screen.getByLabelText('Trier par'), { target: { value: 'prenom' } });
    fireEvent.click(screen.getByLabelText('Inverser le tri'));
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('Élodie');
    fireEvent.change(screen.getByLabelText('Origine du contact'), {
      target: { value: 'invitation' },
    });
    fireEvent.change(screen.getByLabelText('Rechercher un contact'), {
      target: { value: 'elodie' },
    });
    expect(screen.getByText('Élodie')).toBeTruthy();
    fireEvent.click(filtres);
    expect(filtres.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Camille')).toBeNull();
  });

  it('génère un nouveau lien individuel à chaque demande', async () => {
    mock(api.creerLienProspectionVma)
      .mockResolvedValueOnce({
        lien: 'https://site.test/inscription-vma?a=un',
        expireLe: '2099-01-01',
      })
      .mockResolvedValueOnce({
        lien: 'https://site.test/inscription-vma?a=deux',
        expireLe: '2099-01-01',
      });
    render(<ContactsVma slug="demo" onRetour={() => undefined} />);
    fireEvent.click(screen.getByText('Créer un lien de prospection'));
    expect(
      await screen.findByRole('link', { name: 'https://site.test/inscription-vma?a=un' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByText('Créer un lien de prospection'));
    expect(
      await screen.findByRole('link', { name: 'https://site.test/inscription-vma?a=deux' }),
    ).toBeTruthy();
    expect(api.creerLienProspectionVma).toHaveBeenCalledTimes(2);
  });
  it('présente les coordonnées, le suivi et le rattachement réel', async () => {
    render(<ContactsVma slug="demo" onRetour={() => undefined} />);
    expect(await screen.findByText('Camille')).toBeTruthy();
    expect(screen.getByText('Exemple')).toBeTruthy();
    expect(screen.getByText('Direction')).toBeTruthy();
    expect(screen.getByText('0102030405')).toBeTruthy();
    expect(screen.getByRole('cell', { name: /En attente d’envoi/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Rechercher un contact'), {
      target: { value: 'absent' },
    });
    expect(screen.getByText('Aucun contact ne correspond à ces critères.')).toBeTruthy();
  });
  it('crée le contact prérempli avec le téléphone puis lie l’invitation', async () => {
    mock(api.createContact).mockResolvedValue({ id: 'contact-cree' });
    render(<ContactsVma slug="demo" onRetour={() => undefined} />);
    fireEvent.click(await screen.findByText('Rattacher au CRM'));
    const bouton = await screen.findByText('Créer et lier le contact');
    await waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(bouton);
    await waitFor(() =>
      expect(api.rattacherVma).toHaveBeenCalledWith('demo', 'test', {
        contactId: 'contact-cree',
        entrepriseId: null,
      }),
    );
    expect(api.createContact).toHaveBeenCalledWith('demo', {
      nom: 'Camille Exemple',
      fonction: 'Direction',
      email: 'camille@exemple.test',
      telephone: '0102030405',
      entrepriseId: null,
    });
  });
  it('une simulation ne produit aucun rattachement fictif', async () => {
    mock(api.createEntreprise).mockResolvedValue({ message: 'Simulation fictive' } as unknown as {
      id: string;
    });
    render(<ContactsVma slug="demo" onRetour={() => undefined} />);
    fireEvent.click(await screen.findByText('Rattacher au CRM'));
    const bouton = await screen.findByText('Créer et lier l’organisation');
    await waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(bouton);
    expect(await screen.findByText('Simulation fictive')).toBeTruthy();
    expect(api.rattacherVma).not.toHaveBeenCalled();
  });
  it('propose un contact existant au lieu de créer un doublon', async () => {
    mock(api.fetchContacts).mockResolvedValue([
      {
        id: 'existant',
        nom: 'Camille Exemple',
        email: test.contactEmail,
        entrepriseId: 'entreprise-existante',
      },
    ] as api.Contact[]);
    mock(api.fetchEntreprises).mockResolvedValue([
      { id: 'entreprise-existante', nom: 'Entreprise fictive' },
    ] as api.Entreprise[]);
    render(<ContactsVma slug="demo" onRetour={() => undefined} />);
    fireEvent.click(await screen.findByText('Rattacher au CRM'));
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLSelectElement>('Contact existant').value).toBe('existant'),
    );
    expect(screen.queryByText('Créer et lier le contact')).toBeNull();
    fireEvent.click(screen.getByText('Enregistrer le rattachement'));
    await waitFor(() =>
      expect(api.rattacherVma).toHaveBeenCalledWith('demo', 'test', {
        contactId: 'existant',
        entrepriseId: 'entreprise-existante',
      }),
    );
    expect(api.createContact).not.toHaveBeenCalled();
  });
});
