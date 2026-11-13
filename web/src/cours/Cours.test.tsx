// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cours, CoursListe } from './Cours.js';

const api = vi.hoisted(() => ({
  fetchDecksCours: vi.fn(),
  supprimerSupportCours: vi.fn(),
  fetchTexteCours: vi.fn(),
  urlFichierCours: (slug: string, deck: string, f: string) => `/api/i/${slug}/cours/${deck}/${f}`,
}));
vi.mock('../api.js', () => api);

const FICHIERS: Record<string, string> = {
  'manifest.json': JSON.stringify({
    titre: 'Restitution fictive',
    generique: { prenom: 'votre interlocuteur' },
    modules: ['01-resultat.md', '02-suite.md'],
    logo: 'img/logo.svg',
    couleur: '#0C376B',
  }),
  '01-resultat.md': `---
titre: Résultat
duree: 20
---

## Bonjour {{client.prenom}}
type: titre

Restitution du diagnostic.

::: notes
Accueillir, 2 minutes.
:::

---

## Les trois dimensions
type: concept

- Outils
- Stratégie

---

## Un piège
type: piege

Attention.
`,
  '02-suite.md': `---
titre: Suite
---

## Proposition
type: atelier
livrable: Un plan d'action

Gauche.

::: colonne

Droite.
`,
  'clients/client-a.json': '{"prenom":"Alex"}',
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  api.fetchTexteCours.mockReset();
  api.fetchTexteCours.mockImplementation((_s: string, _d: string, f: string) =>
    f in FICHIERS ? Promise.resolve(FICHIERS[f]) : Promise.reject(new Error(`${f} : introuvable`)),
  );
  location.hash = '#/simatis/cours/deck/exemple-fictif';
});
afterEach(cleanup);

const ouvrir = async () => {
  render(<Cours slug="simatis" deck="exemple-fictif" />);
  await screen.findByRole('heading', { name: /Bonjour/ });
};

describe('Lecteur de supports', () => {
  it('affiche la première slide avec les valeurs génériques et le logo du support', async () => {
    await ouvrir();
    expect(screen.getByRole('heading', { name: 'Bonjour votre interlocuteur' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Restitution fictive' }).getAttribute('src')).toBe(
      '/api/i/simatis/cours/exemple-fictif/img/logo.svg',
    );
    expect(screen.getByText('Titre')).toBeTruthy();
  });

  it('remplace les variables par le profil client demandé dans l’adresse', async () => {
    location.hash = '#/simatis/cours/deck/exemple-fictif?client=client-a';
    await ouvrir();
    expect(screen.getByRole('heading', { name: 'Bonjour Alex' })).toBeTruthy();
  });

  it('avance et recule aux flèches, et passe au module suivant en fin de module', async () => {
    await ouvrir();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Les trois dimensions' })).toBeTruthy();
    fireEvent.keyDown(document, { key: ' ' });
    expect(screen.getByRole('heading', { name: 'Un piège' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Proposition' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: 'Un piège' })).toBeTruthy();
  });

  it('change de module avec les chiffres et les flèches haut et bas', async () => {
    await ouvrir();
    fireEvent.keyDown(document, { key: '2' });
    expect(screen.getByRole('heading', { name: 'Proposition' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(screen.getByRole('heading', { name: /Bonjour/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByRole('heading', { name: 'Proposition' })).toBeTruthy();
  });

  it('garde la position dans l’adresse', async () => {
    await ouvrir();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(location.hash).toContain('m=0');
    expect(location.hash).toContain('s=1');
  });

  it('reprend à la position de l’adresse', async () => {
    location.hash = '#/simatis/cours/deck/exemple-fictif?m=1&s=0';
    render(<Cours slug="simatis" deck="exemple-fictif" />);
    expect(await screen.findByRole('heading', { name: 'Proposition' })).toBeTruthy();
    expect(screen.getByText(/Un plan d'action/)).toBeTruthy();
  });

  it('affiche les notes à la touche N, avec la slide suivante', async () => {
    await ouvrir();
    expect(screen.queryByLabelText('Notes du formateur')).toBeNull();
    fireEvent.keyDown(document, { key: 'n' });
    const notes = screen.getByLabelText('Notes du formateur');
    expect(notes.textContent).toContain('Accueillir, 2 minutes.');
    expect(notes.textContent).toContain('Les trois dimensions');
  });

  it('affiche l’aide des raccourcis à la touche ?', async () => {
    await ouvrir();
    fireEvent.keyDown(document, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Raccourcis' })).toBeTruthy();
  });

  it('découpe une slide en colonnes', async () => {
    location.hash = '#/simatis/cours/deck/exemple-fictif?m=1&s=0';
    render(<Cours slug="simatis" deck="exemple-fictif" />);
    await screen.findByRole('heading', { name: 'Proposition' });
    expect(document.querySelectorAll('.cours-colonne')).toHaveLength(2);
  });

  it('dit pourquoi un support ne s’ouvre pas', async () => {
    api.fetchTexteCours.mockRejectedValue(new Error('manifest.json : fichier introuvable'));
    render(<Cours slug="simatis" deck="absent" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/fichier introuvable/)).toBeTruthy();
  });
});

describe('Fin de présentation', () => {
  it('supprime le support après confirmation, puis revient à la liste', async () => {
    api.supprimerSupportCours.mockReset();
    api.supprimerSupportCours.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await ouvrir();
    fireEvent.click(screen.getByRole('button', { name: 'Terminer et supprimer' }));
    await waitFor(() =>
      expect(api.supprimerSupportCours).toHaveBeenCalledWith('simatis', 'exemple-fictif'),
    );
    await waitFor(() => expect(location.hash).toBe('#/simatis/cours'));
  });

  it('ne supprime rien si l’on annule', async () => {
    api.supprimerSupportCours.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await ouvrir();
    fireEvent.click(screen.getByRole('button', { name: 'Terminer et supprimer' }));
    expect(api.supprimerSupportCours).not.toHaveBeenCalled();
  });
});

describe('Lecteur, support en HTML libre', () => {
  const HTML: Record<string, string> = {
    'manifest.json': JSON.stringify({
      titre: 'Deck HTML fictif',
      format: 'html',
      css: 'deck.css',
      polices: [],
      parties: [
        { titre: 'Accueil', duree: 4, slides: ['slides/une.html', 'slides/deux.html'] },
        { titre: 'Suite', slides: ['slides/trois.html'] },
      ],
    }),
    'deck.css': 'section { color: #0b2038; }',
    'slides/une.html': '<section id="une"><h2>Première</h2><aside>Note une.</aside></section>',
    'slides/deux.html': '<section id="deux"><h2>Deuxième</h2></section>',
    'slides/trois.html': '<section id="trois"><h2>Troisième</h2></section>',
  };
  beforeEach(() => {
    api.fetchTexteCours.mockImplementation((_s: string, _d: string, f: string) =>
      f in HTML ? Promise.resolve(HTML[f]) : Promise.reject(new Error(`${f} : introuvable`)),
    );
    location.hash = '#/simatis/cours/deck/html-fictif';
  });

  const cadre = () => document.querySelector('iframe');

  it('affiche chaque slide dans un cadre isolé, sans droits', async () => {
    render(<Cours slug="simatis" deck="html-fictif" />);
    await waitFor(() => expect(cadre()).not.toBeNull());
    expect(cadre()!.getAttribute('sandbox')).toBe('');
    expect(cadre()!.getAttribute('srcdoc')).toContain('<h2>Première</h2>');
    expect(cadre()!.getAttribute('srcdoc')).toContain('section { color: #0b2038; }');
    expect(cadre()!.getAttribute('srcdoc')).not.toContain('Note une.');
  });

  it('navigue entre les slides et les parties, et affiche les notes', async () => {
    render(<Cours slug="simatis" deck="html-fictif" />);
    await waitFor(() => expect(cadre()).not.toBeNull());
    fireEvent.keyDown(document, { key: 'n' });
    expect(screen.getByLabelText('Notes du formateur').textContent).toContain('Note une.');
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(cadre()!.getAttribute('srcdoc')).toContain('<h2>Deuxième</h2>');
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(cadre()!.getAttribute('srcdoc')).toContain('<h2>Troisième</h2>');
    expect(screen.getByText('1 / 1', { exact: false })).toBeTruthy();
  });
});

describe('Liste des supports', () => {
  it('propose chaque support, qui ouvre le lecteur', async () => {
    api.fetchDecksCours.mockResolvedValue([
      { id: 'exemple-fictif', titre: 'Support fictif', soustitre: 'Pour les tests' },
    ]);
    render(<CoursListe slug="simatis" />);
    const lien = await screen.findByRole('link', { name: /Support fictif/ });
    expect(lien.getAttribute('href')).toBe('#/simatis/cours/deck/exemple-fictif');
  });

  it('dit quand aucun dossier n’est configuré', async () => {
    api.fetchDecksCours.mockRejectedValue(new Error("Aucun dossier de supports n'est configuré."));
    render(<CoursListe slug="simatis" />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Aucun dossier/));
  });
});
