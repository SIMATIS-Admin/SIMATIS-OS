// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PastilleInstance } from './PastilleInstance.js';

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let droit = true;
let copieExistante: { type: string; id: string } | null = null;

const noeud = (type: string, id: string, libelle: string, mode: string, obligatoire: boolean) => ({
  type,
  id,
  libelle,
  mode,
  obligatoire,
});
const apercu = (exclusions: { id: string }[]) => ({
  racine: noeud('affaire', 'a1', 'Affaire Fictive', 'deplace', true),
  noeuds: [
    noeud('affaire', 'a1', 'Affaire Fictive', 'deplace', true),
    noeud('tache', 't1', 'Relance fictive', 'deplace', true),
    ...(exclusions.some((e) => e.id === 'c1')
      ? []
      : [noeud('contact', 'c1', 'Contact Fictif', 'copie', false)]),
  ],
  liensRetires: [],
  avertissements: [],
  copieExistante,
});

const reponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  droit = true;
  copieExistante = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url, method: init?.method ?? 'GET', body });
      if (url.endsWith('/transfert/droit')) return Promise.resolve(reponse({ autorise: droit }));
      if (url === '/api/instances')
        return Promise.resolve(
          reponse([
            { slug: 'siege', nom: 'Siège', type: 'propre', phase: null },
            { slug: 'mandat-a', nom: 'Mandat A', type: 'mandat', phase: 'en_cours' },
          ]),
        );
      if (url.endsWith('/transfert/apercu'))
        return Promise.resolve(reponse(apercu((body?.exclusions as { id: string }[]) ?? [])));
      if (url.endsWith('/transfert'))
        return Promise.resolve(
          reponse({ deplaces: 2, copies: 1, racine: { type: 'affaire', id: 'a1', instance: 'x' } }),
        );
      return Promise.resolve(reponse({}, 404));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rendre = (onTransfere = vi.fn()) => {
  render(
    <PastilleInstance
      slug="siege"
      instance={{ slug: 'siege', nom: 'Siège', couleur: null }}
      objet={{ type: 'affaire', id: 'a1' }}
      onTransfere={onTransfere}
    />,
  );
  return onTransfere;
};
const ouvrirAperçu = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Siège/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /Mandat A/ }));
  await screen.findByRole('dialog');
};

describe('PastilleInstance', () => {
  it('ne montre rien sans le droit de transférer', async () => {
    droit = false;
    rendre();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/transfert/droit'))).toBe(true));
    expect(screen.queryByRole('button', { name: /Siège/ })).toBeNull();
  });

  it('propose les autres instances au clic sur la pastille', async () => {
    rendre();
    fireEvent.click(await screen.findByRole('button', { name: /Siège/ }));
    expect(await screen.findByRole('menuitem', { name: /Mandat A/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Siège/ })).toBeNull();
  });

  it('résume ce qui sera déplacé et ce qui sera copié', async () => {
    rendre();
    await ouvrirAperçu();
    expect(await screen.findByText(/1 affaire, 1 tâche seront déplacés/)).toBeTruthy();
    expect(screen.getByText(/1 contact sera copié \(détaché de l’outil d’origine\)/)).toBeTruthy();
  });

  it('renvoie un objet proposé décoché dans les exclusions', async () => {
    rendre();
    await ouvrirAperçu();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Contact Fictif/ }));
    await waitFor(() => {
      const dernier = calls.filter((c) => c.url.endsWith('/transfert/apercu')).at(-1);
      expect(dernier?.body?.exclusions).toEqual([{ type: 'contact', id: 'c1' }]);
    });
  });

  it('confirme le transfert puis prévient la page', async () => {
    const onTransfere = rendre();
    await ouvrirAperçu();
    await screen.findByText(/seront déplacés/);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(onTransfere).toHaveBeenCalledWith('mandat-a'));
    const envoi = calls.find((c) => c.method === 'POST' && c.url.endsWith('/transfert'));
    expect(envoi?.body).toMatchObject({
      type: 'affaire',
      id: 'a1',
      instanceOrigine: 'siege',
      instanceCible: 'mandat-a',
      exclusions: [],
    });
  });

  it('propose d’ouvrir la copie existante ou de copier quand même', async () => {
    copieExistante = { type: 'contact', id: 'c9' };
    rendre();
    await ouvrirAperçu();
    expect(await screen.findByRole('link', { name: 'Ouvrir la copie existante' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copier quand même' }));
    await waitFor(() => {
      const envoi = calls.find((c) => c.method === 'POST' && c.url.endsWith('/transfert'));
      expect(envoi?.body?.copierQuandMeme).toBe(true);
    });
  });
});
