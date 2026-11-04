// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CarteCerveau } from '../cerveau.js';
import { PartageListes } from './PartageListes.js';

const carte: CarteCerveau = {
  noeuds: [
    {
      id: 'echanges/2026-10-29-1200-christophe-q.md',
      titre: 'Question fictive',
      categorie: 'echanges',
      statut: null,
      genre: 'question',
      auteur: 'christophe',
      date: '2026-10-29T12:00:00+01:00',
    },
    {
      id: 'echanges/2026-10-30-0900-marc-r.md',
      titre: 'Réponse fictive',
      categorie: 'echanges',
      statut: null,
      genre: 'reponse',
      auteur: 'marc',
      date: '2026-10-30T09:00:00+01:00',
      reponseA: 'echanges/2026-10-28-1000-marc-autre.md',
    },
    {
      id: 'echanges/2026-11-01-1000-christophe-info.md',
      titre: 'Info fictive',
      categorie: 'echanges',
      statut: null,
      genre: 'info',
      auteur: 'christophe',
      date: '2026-11-01T10:00:00+01:00',
    },
    { id: 'reference/offre.md', titre: 'Offre fictive', categorie: 'reference', statut: null },
  ],
  liens: [],
  autresFichiers: 1,
  fichiers: ['reference/livres-blancs/guide.pdf'],
  lienKdrive: 'https://kdrive.example/dossier',
  tronquee: false,
  misAJour: '2026-11-02T10:00:00Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rendre = (c: CarteCerveau = carte, onOuvrir = vi.fn()) => {
  render(<PartageListes slug="x" carte={c} onOuvrir={onOuvrir} />);
  return onOuvrir;
};

describe('PartageListes', () => {
  it('liste les échanges du plus récent au plus ancien, avec les questions sans réponse en tête', () => {
    rendre();
    const items = screen.getAllByTestId('echange').map((e) => e.textContent ?? '');
    expect(items[0]).toContain('Question fictive');
    expect(items[0]).toContain('Sans réponse');
    expect(items[1]).toContain('Info fictive');
    expect(items[2]).toContain('Réponse fictive');
    expect(screen.queryByText('Offre fictive')).toBeNull();
  });

  it('une question à laquelle une réponse renvoie n’est plus sans réponse', () => {
    rendre({
      ...carte,
      noeuds: carte.noeuds.map((n) =>
        n.id.endsWith('marc-r.md')
          ? { ...n, reponseA: 'echanges/2026-10-29-1200-christophe-q.md' }
          : n,
      ),
    });
    expect(screen.queryByText('Sans réponse')).toBeNull();
  });

  it('ouvre un échange', () => {
    const ouvrir = rendre();
    fireEvent.click(screen.getByRole('button', { name: /Info fictive/ }));
    expect(ouvrir).toHaveBeenCalledWith('echanges/2026-11-01-1000-christophe-info.md');
  });

  it('liste les fichiers non texte avec un lien vers le dossier kDrive', () => {
    rendre();
    expect(screen.getByText('reference/livres-blancs/guide.pdf')).toBeTruthy();
    const lien = screen.getAllByRole('link', { name: /kDrive/ })[0] as HTMLAnchorElement;
    expect(lien.href).toBe('https://kdrive.example/dossier');
    expect(lien.target).toBe('_blank');
    expect(lien.rel).toContain('noopener');
  });

  it('sans lien configuré, dit comment l’ajouter', () => {
    rendre({ ...carte, lienKdrive: null });
    expect(screen.queryByRole('link', { name: /kDrive/ })).toBeNull();
    expect(screen.getByText(/PARTAGE_KDRIVE_URL/)).toBeTruthy();
  });

  it('cherche dans le contenu, ouvre une note, renvoie vers le kDrive pour un autre fichier', async () => {
    const corps = {
      resultats: [
        { chemin: 'reference/offre.md', extraits: ['Un tarif fictif'] },
        { chemin: 'reference/livres-blancs/guide.pdf', extraits: [] },
      ],
    };
    let envoye: unknown;
    vi.stubGlobal('fetch', (_u: string, init: { body: string }) => {
      envoye = JSON.parse(init.body);
      return Promise.resolve(new Response(JSON.stringify(corps)));
    });
    const ouvrir = rendre();
    fireEvent.change(screen.getByLabelText('Chercher dans le contenu'), {
      target: { value: 'tarif' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chercher' }));
    await screen.findByText('Un tarif fictif');
    expect(envoye).toEqual({ espace: 'partage', type: 'chercher', requete: 'tarif' });
    fireEvent.click(screen.getByRole('button', { name: /Offre fictive/ }));
    expect(ouvrir).toHaveBeenCalledWith('reference/offre.md');
    expect(screen.getAllByRole('link', { name: /kDrive/ }).length).toBeGreaterThan(1);
  });

  it('affiche l’absence de résultat et les erreurs', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ resultats: [] }))));
    rendre();
    fireEvent.change(screen.getByLabelText('Chercher dans le contenu'), {
      target: { value: 'zz' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chercher' }));
    await screen.findByText('Aucun résultat.');
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ error: 'Pas connecté' }), { status: 400 })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Chercher' }));
    await waitFor(() => expect(screen.getByText(/Pas connecté/)).toBeTruthy());
  });
});
