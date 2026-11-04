// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CarteCerveau } from '../cerveau.js';
import { Cerveau } from './Cerveau.js';

const carte: CarteCerveau = {
  noeuds: [
    {
      id: 'echanges/2026-10-29-1000-christophe-q.md',
      titre: 'Relais fictif',
      categorie: 'echanges',
      statut: null,
      genre: 'question',
      auteur: 'christophe',
      date: '2026-10-29T10:00:00+01:00',
    },
    {
      id: 'echanges/2026-11-02-0900-marc-t.md',
      titre: 'Test fictif',
      categorie: 'echanges',
      statut: null,
      genre: 'question',
      auteur: 'marc',
      date: '2026-11-02T09:00:00+01:00',
    },
    { id: 'reference/offre.md', titre: 'Offre fictive', categorie: 'reference', statut: null },
  ],
  liens: [],
  autresFichiers: 1,
  fichiers: ['reference/guide.pdf'],
  lienKdrive: 'https://kdrive.example/dossier',
  moi: 'marc',
  tronquee: false,
  misAJour: '2026-11-02T10:00:00Z',
};

let appels: { url: string; corps?: Record<string, unknown> }[];

const faux = (extra: (corps: Record<string, unknown>) => unknown = () => ({})) =>
  vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => {
    const corps = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    appels.push({ url, ...(corps ? { corps } : {}) });
    if (url.includes('cerveau/carte'))
      return Promise.resolve(new Response(JSON.stringify(url.includes('partage') ? carte : null)));
    if (corps?.type === 'lire_messages')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            textes: Object.fromEntries(
              (corps.chemins as string[]).map((c) => [c, `---\nde: x\n---\n\nTexte de ${c}`]),
            ),
          }),
        ),
      );
    if (corps?.type === 'lire')
      return Promise.resolve(
        new Response(JSON.stringify({ contenu: '# Offre', lectureSeule: 'seule', empreinte: 'e' })),
      );
    return Promise.resolve(new Response(JSON.stringify(extra(corps ?? {}))));
  });

beforeEach(() => {
  appels = [];
  faux();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ouvrirPartage = async () => {
  render(<Cerveau slug="x" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Alpes IA' }));
  await screen.findByRole('button', { name: /^Échanges/ });
};

describe('PartageBoite', () => {
  it('trois zones : rubriques avec effectifs, conversations, lecture', async () => {
    await ouvrirPartage();
    expect(screen.getByRole('button', { name: /^Échanges\s*2/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^À répondre\s*1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Documents\s*1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Fichiers\s*1/ })).toBeTruthy();
    const fils = screen.getAllByTestId('fil');
    expect(fils[0]?.textContent).toContain('Test fictif');
    expect(fils[0]?.textContent).toContain('Sans réponse');
    expect(fils[1]?.textContent).toContain('À répondre');
    expect(screen.getByText(/Choisissez une conversation/)).toBeTruthy();
  });

  it('« À répondre » ne garde que les questions de l’autre', async () => {
    await ouvrirPartage();
    fireEvent.click(screen.getByRole('button', { name: /^À répondre/ }));
    const fils = screen.getAllByTestId('fil');
    expect(fils).toHaveLength(1);
    expect(fils[0]?.textContent).toContain('Relais fictif');
  });

  it('lit la conversation à droite et y répond sans quitter la page', async () => {
    await ouvrirPartage();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Relais fictif/ }));
    const lecture = screen.getByLabelText('Lecture');
    await within(lecture).findByText(/Texte de echanges\/2026-10-29-1000-christophe-q.md/);
    fireEvent.change(within(lecture).getByLabelText('Votre réponse'), {
      target: { value: 'Voici ma réponse.' },
    });
    fireEvent.click(within(lecture).getByRole('button', { name: 'Envoyer la réponse' }));
    await within(lecture).findByText('Voici ma réponse.');
    const envoi = appels.find((a) => a.corps?.type === 'message')?.corps;
    expect(envoi).toEqual({
      espace: 'partage',
      type: 'message',
      genre: 'reponse',
      sujet: 'Re : Relais fictif',
      corps: 'Voici ma réponse.',
      enReponseA: 'echanges/2026-10-29-1000-christophe-q.md',
    });
  });

  it('ne dépose rien si la confirmation est refusée', async () => {
    await ouvrirPartage();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /Relais fictif/ }));
    const lecture = screen.getByLabelText('Lecture');
    fireEvent.change(await within(lecture).findByLabelText('Votre réponse'), {
      target: { value: 'Brouillon' },
    });
    fireEvent.click(within(lecture).getByRole('button', { name: 'Envoyer la réponse' }));
    expect(appels.some((a) => a.corps?.type === 'message')).toBe(false);
  });

  it('un document s’ouvre dans la zone de lecture', async () => {
    await ouvrirPartage();
    fireEvent.click(screen.getByRole('button', { name: /^Documents/ }));
    fireEvent.click(screen.getByRole('button', { name: /Offre fictive/ }));
    await waitFor(() => expect(screen.getByLabelText('Texte de reference/offre.md')).toBeTruthy());
  });

  it('les fichiers non texte renvoient vers le kDrive', async () => {
    await ouvrirPartage();
    fireEvent.click(screen.getByRole('button', { name: /^Fichiers/ }));
    expect(screen.getByText('reference/guide.pdf')).toBeTruthy();
    const lien = screen.getByRole<HTMLAnchorElement>('link', { name: /kDrive/ });
    expect(lien.href).toBe('https://kdrive.example/dossier');
    expect(lien.rel).toContain('noopener');
  });

  it('une recherche filtre les titres, puis cherche dans le contenu et ouvre le résultat', async () => {
    faux(() => ({
      resultats: [
        { chemin: 'echanges/2026-10-29-1000-christophe-q.md', extraits: ['une ligne fictive'] },
        { chemin: 'reference/guide.pdf', extraits: [] },
      ],
    }));
    await ouvrirPartage();
    fireEvent.change(screen.getByLabelText('Chercher partout'), { target: { value: 'relais' } });
    expect(screen.getAllByTestId('fil')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Chercher dans le contenu' }));
    await screen.findByText('une ligne fictive');
    expect(screen.getAllByRole('link', { name: /kDrive/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Relais fictif' }));
    await screen.findByLabelText('Votre réponse');
  });

  it('« Nouveau message » ouvre le formulaire à droite', async () => {
    await ouvrirPartage();
    fireEvent.click(screen.getByRole('button', { name: 'Nouveau message' }));
    expect(
      within(screen.getByLabelText('Lecture')).getByLabelText('Sujet du message'),
    ).toBeTruthy();
  });
});
