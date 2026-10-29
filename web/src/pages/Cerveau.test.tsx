// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cerveau } from './Cerveau.js';

const carte = {
  noeuds: [
    { id: 'index.md', titre: 'Accueil fictif', categorie: 'racine', statut: null },
    {
      id: 'brain/clients/acme.md',
      titre: 'Acme fictive',
      categorie: 'clients',
      statut: 'verified',
    },
    { id: 'brain/mandats/projet.md', titre: 'Projet fictif', categorie: 'mandats', statut: null },
  ],
  liens: [
    { de: 'index.md', vers: 'brain/clients/acme.md' },
    { de: 'brain/clients/acme.md', vers: 'brain/mandats/projet.md' },
  ],
  autresFichiers: 4,
  tronquee: false,
  misAJour: '2026-10-29T10:00:00Z',
};

const repondre = (corps: unknown, status = 200) =>
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(corps), { status })));

beforeEach(() => repondre(carte));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Cerveau', () => {
  it('affiche les notes, la légende avec les effectifs et le total', async () => {
    render(<Cerveau slug="x" />);
    await waitFor(() => expect(screen.getByLabelText('Légende')).toBeTruthy());
    const legende = screen.getByLabelText('Légende');
    expect(legende.textContent).toContain('Clients');
    expect(legende.textContent).toContain('Mandats');
    expect(screen.getByText(/3 notes, 2 liens, 4 autres fichiers/)).toBeTruthy();
    expect(screen.getByTestId('noeud-index.md')).toBeTruthy();
  });

  it('un clic sur une note montre ses liens, un clic sur un lien navigue', async () => {
    render(<Cerveau slug="x" />);
    fireEvent.click(await screen.findByTestId('noeud-brain/clients/acme.md'));
    expect(screen.getByText('Cité par')).toBeTruthy();
    expect(screen.getByText('Renvoie vers')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Projet fictif' }));
    expect(screen.getByText('brain/mandats/projet.md')).toBeTruthy();
  });

  it('la légende masque une catégorie', async () => {
    render(<Cerveau slug="x" />);
    await screen.findByLabelText('Légende');
    fireEvent.click(screen.getByRole('button', { name: /Clients/ }));
    expect(screen.queryByTestId('noeud-brain/clients/acme.md')).toBeNull();
    expect(screen.getByTestId('noeud-index.md')).toBeTruthy();
  });

  it('explique quand la carte n’est pas encore arrivée', async () => {
    repondre(null);
    render(<Cerveau slug="x" />);
    expect(await screen.findByText(/pas encore arrivée/)).toBeTruthy();
  });

  it('affiche le refus du serveur', async () => {
    repondre({ error: "Le second cerveau n'est pas activé dans cet espace." }, 403);
    render(<Cerveau slug="x" />);
    expect(await screen.findByText(/pas activé/)).toBeTruthy();
  });
});

describe('Cerveau : édition', () => {
  type Appel = { url: string; body: Record<string, unknown> | null };
  let appels: Appel[] = [];
  const brancher = (reponses: (op: Record<string, unknown>) => Response) => {
    appels = [];
    vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      appels.push({ url, body });
      return Promise.resolve(
        url.endsWith('/cerveau/operations')
          ? reponses(body ?? {})
          : new Response(JSON.stringify(carte)),
      );
    });
  };
  const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status });

  it('ouvre une note, la modifie et l’enregistre avec son empreinte', async () => {
    brancher((op) =>
      op.type === 'lire'
        ? json({ chemin: op.chemin, contenu: '# Acme fictive', empreinte: 'e1' })
        : json({ chemin: op.chemin, empreinte: 'e2' }),
    );
    render(<Cerveau slug="x" />);
    fireEvent.click(await screen.findByTestId('noeud-brain/clients/acme.md'));
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir et modifier' }));
    const zone = await screen.findByLabelText<HTMLTextAreaElement>(
      'Texte de brain/clients/acme.md',
    );
    await waitFor(() => expect(zone.value).toBe('# Acme fictive'));
    const bouton = screen.getByRole<HTMLButtonElement>('button', { name: 'Enregistrer' });
    expect(bouton.disabled).toBe(true);
    fireEvent.change(zone, { target: { value: '# Acme fictive\n\nAjout.' } });
    fireEvent.click(bouton);
    await screen.findByText(/Enregistré dans le Drive/);
    expect(appels.find((a) => a.body?.type === 'ecrire')?.body).toEqual({
      type: 'ecrire',
      chemin: 'brain/clients/acme.md',
      contenu: '# Acme fictive\n\nAjout.',
      empreinte: 'e1',
    });
  });

  it('propose de recharger quand la note a changé ailleurs', async () => {
    brancher((op) =>
      op.type === 'lire'
        ? json({ contenu: 'a', empreinte: 'e1' })
        : json({ error: 'La note a été modifiée ailleurs.' }, 409),
    );
    render(<Cerveau slug="x" />);
    fireEvent.click(await screen.findByTestId('noeud-index.md'));
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir et modifier' }));
    const zone = await screen.findByLabelText('Texte de index.md');
    await waitFor(() => expect((zone as HTMLTextAreaElement).value).toBe('a'));
    fireEvent.change(zone, { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('button', { name: 'Recharger la note' })).toBeTruthy();
    expect((zone as HTMLTextAreaElement).value).toBe('b');
  });

  it('dépose une idée dans l’inbox puis ouvre la note créée', async () => {
    brancher((op) =>
      op.type === 'ajouter'
        ? json({ chemin: 'brain/inbox/2026-10-29_idee.md' })
        : json({ contenu: '# Idée', empreinte: 'e1' }),
    );
    render(<Cerveau slug="x" />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Ajouter une idée' }));
    const deposer = screen.getByRole<HTMLButtonElement>('button', { name: 'Déposer dans l’inbox' });
    expect(deposer.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Titre de l'idée"), { target: { value: 'Idée' } });
    fireEvent.change(screen.getByLabelText("Texte de l'idée"), { target: { value: 'Détail' } });
    fireEvent.click(deposer);
    expect(await screen.findByLabelText('Texte de brain/inbox/2026-10-29_idee.md')).toBeTruthy();
    expect(appels.find((a) => a.body?.type === 'ajouter')?.body).toEqual({
      type: 'ajouter',
      titre: 'Idée',
      texte: 'Détail',
    });
  });
});
