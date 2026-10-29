// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeuilleDeRouteOS } from './FeuilleDeRouteOS.js';

const FEUILLE = 'brain/outils/simatis-os-feuille-de-route.md';
const STRUCTURE = 'brain/outils/simatis-os-structure.md';
const IDEE = 'brain/idees-en-vrac/2026-10-29_idee-fictive.md';
const carte = {
  noeuds: [
    {
      id: IDEE,
      titre: 'Idée fictive',
      categorie: 'idees-en-vrac',
      statut: 'draft',
      concerne: 'os',
    },
    {
      id: 'brain/idees-en-vrac/promue.md',
      titre: 'Déjà promue',
      categorie: 'idees-en-vrac',
      statut: 'promue',
      concerne: 'os',
    },
    {
      id: 'brain/idees-en-vrac/autre.md',
      titre: 'Autre sujet',
      categorie: 'idees-en-vrac',
      statut: 'draft',
      concerne: null,
    },
  ],
  liens: [],
  autresFichiers: 0,
  tronquee: false,
  misAJour: '2026-10-29T10:00:00Z',
};

type Corps = Record<string, unknown>;
let appels: Corps[] = [];
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status });

// `reponse` répond aux opérations ; par défaut, lecture du contenu fictif de chaque note.
const brancher = (reponse?: (op: Corps) => Response | undefined) => {
  appels = [];
  vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => {
    if (!url.includes('/cerveau/operations')) return Promise.resolve(json(carte));
    const op = JSON.parse(init?.body ?? '{}') as Corps;
    appels.push(op);
    const surmesure = reponse?.(op);
    if (surmesure) return Promise.resolve(surmesure);
    const contenus: Record<string, string> = {
      [FEUILLE]: '# Feuille fictive\n\n- fait — x',
      [STRUCTURE]: '# Structure fictive',
      [IDEE]: '---\nstatut: draft\nconcerne: os\n---\n\n# Idée fictive',
    };
    return Promise.resolve(json({ contenu: contenus[String(op.chemin)] ?? '', empreinte: 'e1' }));
  });
};

beforeEach(() => brancher());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FeuilleDeRouteOS', () => {
  it('affiche les deux notes et seulement les idées OS en attente', async () => {
    render(<FeuilleDeRouteOS slug="x" autorise />);
    expect(await screen.findByText(/Feuille fictive/)).toBeTruthy();
    expect(await screen.findByText(/Structure fictive/)).toBeTruthy();
    expect(await screen.findByText('Idée fictive')).toBeTruthy();
    expect(screen.queryByText('Déjà promue')).toBeNull();
    expect(screen.queryByText('Autre sujet')).toBeNull();
  });

  it('ouvre l’éditeur de la note puis le ferme', async () => {
    render(<FeuilleDeRouteOS slug="x" autorise />);
    await screen.findByText(/Structure fictive/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Modifier' })[1] as HTMLElement);
    expect(await screen.findByLabelText(`Texte de ${STRUCTURE}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(screen.queryByLabelText(`Texte de ${STRUCTURE}`)).toBeNull());
  });

  it('promeut une idée : étape ajoutée puis idée marquée', async () => {
    render(<FeuilleDeRouteOS slug="x" autorise />);
    fireEvent.click(await screen.findByRole('button', { name: 'Promouvoir en étape' }));
    await waitFor(() => expect(appels.filter((a) => a.type === 'ecrire')).toHaveLength(2));
    const [etape, idee] = appels.filter((a) => a.type === 'ecrire');
    expect(etape).toMatchObject({ chemin: FEUILLE, empreinte: 'e1' });
    expect(String(etape?.contenu)).toContain(
      '- à faire — [Idée fictive](../idees-en-vrac/2026-10-29_idee-fictive.md)',
    );
    expect(idee).toMatchObject({ chemin: IDEE });
    expect(String(idee?.contenu)).toContain('statut: promue');
  });

  it('retire l’idée de la liste dès la promotion, même si la carte est encore ancienne', async () => {
    render(<FeuilleDeRouteOS slug="x" autorise />);
    fireEvent.click(await screen.findByRole('button', { name: 'Promouvoir en étape' }));
    await waitFor(() => expect(screen.queryByText('Idée fictive')).toBeNull());
  });

  it('n’ajoute pas une seconde fois une étape déjà liée à l’idée', async () => {
    brancher((op) =>
      op.type === 'lire' && op.chemin === FEUILLE
        ? json({
            contenu: '- à faire — [Idée fictive](../idees-en-vrac/2026-10-29_idee-fictive.md)\n',
            empreinte: 'e1',
          })
        : undefined,
    );
    render(<FeuilleDeRouteOS slug="x" autorise />);
    fireEvent.click(await screen.findByRole('button', { name: 'Promouvoir en étape' }));
    await waitFor(() => expect(appels.filter((a) => a.type === 'ecrire')).toHaveLength(1));
    expect(appels.find((a) => a.type === 'ecrire')).toMatchObject({ chemin: IDEE });
  });

  it('en cas de conflit sur la feuille, n’écrit rien sur l’idée', async () => {
    brancher((op) =>
      op.type === 'ecrire' ? json({ error: 'La note a été modifiée ailleurs.' }, 409) : undefined,
    );
    render(<FeuilleDeRouteOS slug="x" autorise />);
    fireEvent.click(await screen.findByRole('button', { name: 'Promouvoir en étape' }));
    expect(await screen.findByText(/modifiée ailleurs/)).toBeTruthy();
    expect(appels.filter((a) => a.type === 'ecrire')).toHaveLength(1);
    expect(appels.some((a) => a.chemin === IDEE && a.type === 'ecrire')).toBe(false);
  });

  it('signale l’échec du marquage de l’idée une fois l’étape ajoutée', async () => {
    brancher((op) =>
      op.type === 'ecrire' && op.chemin === IDEE ? json({ error: 'Disque plein' }, 400) : undefined,
    );
    render(<FeuilleDeRouteOS slug="x" autorise />);
    fireEvent.click(await screen.findByRole('button', { name: 'Promouvoir en étape' }));
    expect(
      await screen.findByText(/L’étape a été ajoutée, mais l’idée n’a pas pu être marquée/),
    ).toBeTruthy();
  });

  it('affiche l’erreur de lecture sans planter', async () => {
    brancher((op) =>
      op.type === 'lire' && op.chemin === FEUILLE
        ? json({ error: 'Note introuvable' }, 400)
        : undefined,
    );
    render(<FeuilleDeRouteOS slug="x" autorise />);
    expect(await screen.findByText('Note introuvable')).toBeTruthy();
    expect(await screen.findByText(/Structure fictive/)).toBeTruthy();
  });

  it('n’appelle rien quand l’espace n’est pas autorisé', () => {
    render(<FeuilleDeRouteOS slug="x" autorise={false} />);
    expect(screen.getByText(/pas disponible dans cet espace/)).toBeTruthy();
    expect(appels).toHaveLength(0);
  });
});
