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
    expect(screen.getByText('Contact non lié')).toBeTruthy();
    expect(screen.getByText('Organisation non liée')).toBeTruthy();
    expect(screen.getByText('Mail non envoyé')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Rechercher un contact VMA'), {
      target: { value: 'absent' },
    });
    expect(screen.getByText('Aucun contact ne correspond à ces critères.')).toBeTruthy();
  });
  it('crée le contact prérempli avec le téléphone puis lie l’invitation', async () => {
    mock(api.createContact).mockResolvedValue({ id: 'contact-cree' });
    render(<ContactsVma slug="demo" onRetour={() => undefined} />);
    fireEvent.click(await screen.findByText('Gérer les fiches CRM'));
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
    fireEvent.click(await screen.findByText('Gérer les fiches CRM'));
    const bouton = screen.getByText('Créer et lier l’organisation');
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
    fireEvent.click(await screen.findByText('Gérer les fiches CRM'));
    fireEvent.click(await screen.findByText('Sélectionner Camille Exemple'));
    expect(screen.getByText<HTMLButtonElement>('Créer et lier le contact').disabled).toBe(true);
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
