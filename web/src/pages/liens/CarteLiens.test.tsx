// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarteLiens, type LigneLien } from './CarteLiens.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let simulation = false;
let creationSimulee = false;

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (url.includes('/contacts?q=')) return json([{ id: 'c9', nom: 'Personne trouvée' }]);
  if (url.includes('/entreprises?q=')) return json([{ id: 'e9', nom: 'Organisation trouvée' }]);
  if (url.includes('/opportunites/recherche'))
    return json([{ id: 'o9', titre: 'Affaire trouvée', entreprise: null, clos: null }]);
  if (url.endsWith('/pipeline')) return json({ etapes: [{ id: 'detection', label: 'Détection' }] });
  if (url.endsWith('/contacts') && method === 'POST')
    return creationSimulee
      ? json({ simulation: true, message: 'Simulation : rien créé.' }, 202)
      : json({ id: 'c-nouveau' }, 201);
  if (url.includes('/liens'))
    return json(
      simulation ? { simulation: true, message: 'Simulation : rien écrit.' } : { ok: true },
    );
  return json({});
}

const lignes: LigneLien[] = [
  { id: 'c1', nom: 'Agathe Fictive', principal: true },
  { id: 'c2', nom: 'Romain Fictif', principal: false },
];
const de = { kind: 'affaire' as const, id: 'o1' };

function monter(extra: Partial<Parameters<typeof CarteLiens>[0]> = {}) {
  const onChange = vi.fn();
  const onMessage = vi.fn();
  render(
    <CarteLiens
      slug="demo"
      titre="Contacts"
      kind="contact"
      de={de}
      lignes={lignes}
      ecrit
      principalGerable
      onChange={onChange}
      onMessage={onMessage}
      {...extra}
    />,
  );
  return { onChange, onMessage };
}

describe('CarteLiens', () => {
  beforeEach(() => {
    calls = [];
    simulation = false;
    creationSimulee = false;
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('liste les liens avec le principal et le compte dans le titre', () => {
    monter();
    expect(screen.getByRole('heading', { name: 'Contacts (2)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Agathe Fictive' }).getAttribute('href')).toBe(
      '#/demo/fiche/contact/c1',
    );
    expect(screen.getAllByText('Principal')).toHaveLength(1);
  });

  it('affiche « (0) » et « + Ajouter » pour une fiche sans lien', () => {
    monter({ lignes: [] });
    expect(screen.getByRole('heading', { name: 'Contacts (0)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Ajouter' })).toBeTruthy();
  });

  it('lie une fiche existante trouvée par la recherche', async () => {
    const { onChange } = monter();
    fireEvent.click(screen.getByRole('button', { name: '+ Ajouter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lier une fiche existante' }));
    fireEvent.change(screen.getByLabelText('Rechercher à lier'), { target: { value: 'tro' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Personne trouvée' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const appel = calls.find(
      (c) => c.method === 'POST' && c.url.endsWith('/fiches/affaire/o1/liens'),
    );
    expect(appel?.body).toEqual({ avec: { kind: 'contact', id: 'c9' } });
  });

  it('crée une fiche déjà liée à celle de la page', async () => {
    const { onChange } = monter();
    fireEvent.click(screen.getByRole('button', { name: '+ Ajouter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Nouvelle Personne' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const appel = calls.find((c) => c.method === 'POST' && c.url.endsWith('/contacts'));
    expect(appel?.body).toMatchObject({ nom: 'Nouvelle Personne', lierA: de });
  });

  it('délie et change le principal', async () => {
    const { onChange } = monter();
    fireEvent.click(screen.getByRole('button', { name: 'Délier Romain Fictif' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({
      avec: { kind: 'contact', id: 'c2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Définir Romain Fictif comme principal' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url.endsWith('/fiches/affaire/o1/liens/principal')).toBe(true);
    expect(put?.body).toEqual({ avec: { kind: 'contact', id: 'c2' } });
  });

  it('affiche le message de simulation et ne recharge pas la fiche', async () => {
    simulation = true;
    const { onChange, onMessage } = monter();
    fireEvent.click(screen.getByRole('button', { name: 'Délier Romain Fictif' }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith('Simulation : rien écrit.'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('masque les boutons quand la fiche n’est pas modifiable', () => {
    monter({ ecrit: false });
    expect(screen.queryByRole('button', { name: '+ Ajouter' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Délier/ })).toBeNull();
  });

  it('ne propose pas le principal quand la fiche n’en est pas propriétaire', () => {
    monter({ principalGerable: false });
    expect(screen.queryByRole('button', { name: /comme principal/ })).toBeNull();
    expect(screen.queryByText('Principal')).toBeNull();
  });

  it('affiche le message quand la création est simulée, sans recharger', async () => {
    creationSimulee = true;
    const { onChange, onMessage } = monter();
    fireEvent.click(screen.getByRole('button', { name: '+ Ajouter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Personne simulée' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith('Simulation : rien créé.'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
