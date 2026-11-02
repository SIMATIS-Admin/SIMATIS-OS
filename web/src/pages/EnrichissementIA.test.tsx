// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LancerEnrichissement, SuggestionsEnrichissement } from './EnrichissementIA.js';

type Appel = { url: string; method: string; body?: unknown };
let appels: Appel[];
let tache: { etat: string; erreur: string | null; jetons: number };
let lignes: { id: string; entreprise: string; etat: string; raison: string | null }[];
let suggestions: Record<string, unknown>[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  appels.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  if (method === 'POST' && url.endsWith('/base/enrichissement'))
    return json({ id: 'tache-1' }, 202);
  if (method === 'POST' && url.endsWith('/valider'))
    return json({ appliquees: 1, creees: 0, echecs: 0 });
  if (url.endsWith('/suggestions')) return json(suggestions);
  return json({ tache, lignes });
}

const s = (extra: Record<string, unknown>) => ({
  id: 's1',
  ficheId: 'f1',
  entreprise: 'Atelier Fictif',
  contactExistant: null,
  prenom: 'Claire',
  nom: 'Martin',
  fonction: 'DRH',
  email: 'claire@atelier-fictif.test',
  telephone: null,
  sourceUrl: 'https://atelier-fictif.test/equipe',
  confiance: 'haute',
  modeEmail: 'trouve',
  etat: 'a_valider',
  ...extra,
});

beforeEach(() => {
  appels = [];
  tache = { etat: 'terminee', erreur: null, jetons: 120 };
  lignes = [];
  suggestions = [];
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('lancement d’un enrichissement', () => {
  const ouvrir = (extra = {}) => {
    const onLance = vi.fn();
    render(
      <LancerEnrichissement
        slug="simatis"
        ficheIds={['f1', 'f2']}
        lotMax={5}
        onFermer={() => undefined}
        onLance={onLance}
        {...extra}
      />,
    );
    return onLance;
  };

  it('envoie le type, les fonctions saisies et le maximum par entreprise', async () => {
    const onLance = ouvrir();
    expect(screen.getByText(/envoyés à OpenAI/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Fonctions recherchées'), {
      target: { value: 'Responsable achats, DRH' },
    });
    fireEvent.change(screen.getByLabelText('Contacts maximum par entreprise'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByText('Lancer sur 2 fiches'));
    await waitFor(() => expect(onLance).toHaveBeenCalledWith('tache-1'));
    expect(appels.find((a) => a.method === 'POST')?.body).toEqual({
      type: 'contacts',
      profil: ['Responsable achats', 'DRH'],
      maxParEntreprise: 2,
      ficheIds: ['f1', 'f2'],
    });
  });

  it('propose des fonctions types en un clic', () => {
    ouvrir();
    fireEvent.click(screen.getByText('DRH'));
    expect(screen.getByLabelText<HTMLInputElement>('Fonctions recherchées').value).toBe('DRH');
    fireEvent.click(screen.getByText('DRH'));
    expect(screen.getByLabelText<HTMLInputElement>('Fonctions recherchées').value).toBe('');
  });

  it('désactive le lancement sans fonction, sauf pour compléter les coordonnées', () => {
    ouvrir();
    expect(screen.getByText<HTMLButtonElement>('Lancer sur 2 fiches').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Compléter les mails et téléphones/));
    expect(screen.getByText<HTMLButtonElement>('Lancer sur 2 fiches').disabled).toBe(false);
  });

  it('refuse une sélection plus grande que le lot maximal', () => {
    ouvrir({ ficheIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(screen.getByText(/limité à 5 fiches/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Fonctions recherchées'), { target: { value: 'DRH' } });
    expect(screen.getByText<HTMLButtonElement>('Lancer sur 6 fiches').disabled).toBe(true);
  });
});

describe('validation des suggestions', () => {
  const ouvrir = () => {
    const onFini = vi.fn();
    render(<SuggestionsEnrichissement slug="simatis" tacheId="tache-1" onFini={onFini} />);
    return onFini;
  };

  it('groupe par entreprise, source cliquable, et n’envoie que ce qui est coché', async () => {
    suggestions = [
      s({}),
      s({
        id: 's2',
        prenom: 'Paul',
        nom: 'Petit',
        email: 'paul@atelier-fictif.test',
        modeEmail: 'deduit',
        confiance: 'basse',
        sourceUrl: null,
      }),
    ];
    const onFini = ouvrir();
    expect(await screen.findByText('Atelier Fictif')).toBeTruthy();
    const lien = screen.getByText<HTMLAnchorElement>('Source');
    expect(lien.getAttribute('href')).toBe('https://atelier-fictif.test/equipe');
    expect(lien.getAttribute('target')).toBe('_blank');
    expect(lien.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('déduit')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Garder Claire Martin').checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Garder Paul Petit').checked).toBe(false);
    fireEvent.click(screen.getByText('Valider la sélection'));
    await waitFor(() => expect(onFini).toHaveBeenCalled());
    expect(appels.find((a) => a.method === 'POST')?.body).toEqual({
      accepter: ['s1'],
      refuser: ['s2'],
    });
  });

  it('liste les fiches écartées ou en échec avec leur raison', async () => {
    lignes = [
      { id: 'l1', entreprise: 'Bureau Fictif', etat: 'ignoree', raison: 'Fiche en opposition' },
      { id: 'l2', entreprise: 'Cabinet Fictif', etat: 'echec', raison: 'Réponse hors schéma' },
    ];
    ouvrir();
    expect(await screen.findByText(/Bureau Fictif/)).toBeTruthy();
    expect(screen.getByText(/Fiche en opposition/)).toBeTruthy();
    expect(screen.getByText(/Réponse hors schéma/)).toBeTruthy();
  });

  it('un lot interrompu affiche la cause', async () => {
    tache = { etat: 'interrompue', erreur: 'Quota OpenAI atteint', jetons: 10 };
    ouvrir();
    expect(await screen.findByText(/Quota OpenAI atteint/)).toBeTruthy();
  });

  it('dit quand rien n’a été trouvé', async () => {
    ouvrir();
    expect(await screen.findByText(/Aucun contact trouvé/)).toBeTruthy();
  });
});
