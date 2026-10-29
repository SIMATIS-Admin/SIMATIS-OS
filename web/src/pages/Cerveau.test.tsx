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

  it('« Réinitialiser la vue » remet légende, recherche et sélection à zéro', async () => {
    render(<Cerveau slug="x" />);
    fireEvent.click(await screen.findByRole('button', { name: /Clients/ }));
    fireEvent.click(screen.getByTestId('noeud-index.md'));
    fireEvent.change(screen.getByLabelText('Chercher une note'), { target: { value: 'projet' } });
    expect(screen.queryByTestId('noeud-brain/clients/acme.md')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser la vue' }));

    expect(screen.getByTestId('noeud-brain/clients/acme.md')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Chercher une note').value).toBe('');
    expect(screen.getByText(/Cliquez sur une note de la carte/)).toBeTruthy();
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
      espace: 'simatis',
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
      espace: 'simatis',
      type: 'ajouter',
      titre: 'Idée',
      texte: 'Détail',
    });
  });
});

describe('Cerveau : espace partagé', () => {
  type Appel = { url: string; body: Record<string, unknown> | null };
  let appels: Appel[] = [];
  const cartePartage = {
    noeuds: [
      { id: 'reference/offre.md', titre: 'Offre fictive', categorie: 'reference', statut: null },
      { id: 'prospection/point.md', titre: 'Point fictif', categorie: 'prospection', statut: null },
      {
        id: 'echanges/2026-10-29-1200-christophe-question.md',
        titre: 'Question fictive',
        categorie: 'echanges',
        statut: null,
      },
    ],
    liens: [],
    autresFichiers: 0,
    tronquee: false,
    misAJour: '2026-10-29T10:00:00Z',
  };
  const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status });
  const brancher = (operations: (op: Record<string, unknown>) => Response) => {
    appels = [];
    vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      appels.push({ url, body });
      if (url.includes('/cerveau/operations')) return Promise.resolve(operations(body ?? {}));
      return Promise.resolve(json(url.includes('espace=partage') ? cartePartage : carte));
    });
  };
  const ouvrirPartage = async () => {
    render(<Cerveau slug="x" />);
    await screen.findByLabelText('Légende');
    fireEvent.click(screen.getByRole('button', { name: 'Partagé' }));
    await screen.findByTestId('noeud-reference/offre.md');
  };

  it('le sélecteur bascule sur la carte de l’espace partagé', async () => {
    brancher(() => json({}));
    await ouvrirPartage();
    expect(appels.some((a) => a.url.includes('cerveau/carte?espace=partage'))).toBe(true);
    expect(screen.getByLabelText('Légende').textContent).toContain('Référence (Christophe)');
    expect(screen.queryByTestId('noeud-index.md')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Nouveau message' })).toBeTruthy();
  });

  it('une note du dossier de Christophe s’ouvre en lecture seule, sans bouton Enregistrer', async () => {
    brancher(() =>
      json({
        contenu: '# Offre',
        empreinte: 'e1',
        lectureSeule: 'Ce dossier appartient à Christophe.',
      }),
    );
    await ouvrirPartage();
    fireEvent.click(screen.getByTestId('noeud-reference/offre.md'));
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir et modifier' }));
    expect(await screen.findByText(/appartient à Christophe/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Texte de reference/offre.md').readOnly).toBe(
      true,
    );
    expect(appels.find((a) => a.body?.type === 'lire')?.body?.espace).toBe('partage');
  });

  it('on répond à un message après confirmation, et rien ne part sans elle', async () => {
    brancher((op) =>
      op.type === 'message'
        ? json({ chemin: 'echanges/2026-10-29-1300-marc-reponse.md' })
        : json({
            contenu: 'Corps',
            empreinte: 'e1',
            lectureSeule: 'Un message déposé ne se modifie plus.',
          }),
    );
    await ouvrirPartage();
    fireEvent.click(screen.getByTestId('noeud-echanges/2026-10-29-1200-christophe-question.md'));
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir et modifier' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Répondre à ce message' }));
    fireEvent.change(screen.getByLabelText('Sujet du message'), {
      target: { value: 'Re : question' },
    });
    fireEvent.change(screen.getByLabelText('Corps du message'), {
      target: { value: 'Voici la réponse.' },
    });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Déposer le message' }));
    expect(appels.some((a) => a.body?.type === 'message')).toBe(false);

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Déposer le message' }));
    await waitFor(() => expect(appels.some((a) => a.body?.type === 'message')).toBe(true));
    expect(appels.find((a) => a.body?.type === 'message')?.body).toEqual({
      espace: 'partage',
      type: 'message',
      genre: 'reponse',
      sujet: 'Re : question',
      corps: 'Voici la réponse.',
      enReponseA: 'echanges/2026-10-29-1200-christophe-question.md',
    });
    confirm.mockRestore();
  });

  it('publie un nouveau document dans prospection/', async () => {
    brancher((op) =>
      op.type === 'ajouter'
        ? json({ chemin: 'prospection/2026-10-29_point.md' })
        : json({ contenu: '# Point', empreinte: 'e1', lectureSeule: null }),
    );
    await ouvrirPartage();
    fireEvent.click(screen.getByRole('button', { name: '+ Nouveau document' }));
    fireEvent.change(screen.getByLabelText('Titre du document'), { target: { value: 'Point' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publier dans prospection/' }));
    expect(await screen.findByLabelText('Texte de prospection/2026-10-29_point.md')).toBeTruthy();
    expect(appels.find((a) => a.body?.type === 'ajouter')?.body).toMatchObject({
      espace: 'partage',
    });
  });
});
