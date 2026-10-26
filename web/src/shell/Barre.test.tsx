// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Barre } from './Barre.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let droit = false;

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url.endsWith('/transfert/droit')) return json({ autorise: droit });
  if (url === '/api/instances')
    return json([
      { slug: 'simatis', nom: 'SIMATIS', type: 'propre', phase: null },
      { slug: 'mandat-a', nom: 'Mandat A', type: 'mandat', phase: 'en_cours' },
      { slug: 'mandat-b', nom: 'Mandat B', type: 'mandat', phase: 'en_cours' },
    ]);
  if (method === 'POST' && url.endsWith('/transfert'))
    return json({ deplaces: 0, copies: 1, racine: { type: 'contact', id: 'c9', instance: 'x' } });
  if (url.endsWith('/transfert/apercu')) {
    const noeud = {
      type: 'contact',
      id: 'c7',
      libelle: 'Paul Dupont',
      mode: 'copie',
      obligatoire: true,
    };
    return json({
      racine: noeud,
      noeuds: [noeud],
      liensRetires: [],
      avertissements: [],
      copieExistante: null,
    });
  }
  if (url.includes('portee=mandats'))
    return json({
      mandats: [
        {
          instance: { slug: 'mandat-a', nom: 'Mandat A', couleur: null },
          affaires: [],
          personnes: [{ id: 'c7', nom: 'Paul Dupont', entreprise: null }],
          organisations: [],
        },
      ],
    });
  if (url.includes('/recherche?q='))
    return json({
      affaires: [{ id: 'o1', titre: 'Structuration', entreprise: 'Fonderie Vallière', clos: null }],
      personnes: [{ id: 'c1', nom: 'Agathe Vallière', entreprise: 'Fonderie Vallière' }],
      organisations: [{ id: 'e1', nom: 'Fonderie Vallière', ville: 'Rumilly' }],
    });
  if (url.endsWith('/pipeline'))
    return json({ etapes: [{ id: 'qualification', label: 'Qualification' }], opportunites: [] });
  if (method === 'POST' && url.endsWith('/opportunites')) return json({ id: 'o9' });
  return json([]);
}

describe('Barre (recherche globale et ajout rapide)', () => {
  beforeEach(() => {
    calls = [];
    droit = false;
    location.hash = '';
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('searches deals, people and organisations, and opens the chosen one', async () => {
    render(<Barre slug="simatis" />);
    fireEvent.change(screen.getByLabelText('Recherche globale'), { target: { value: 'vall' } });
    const resultats = await screen.findByRole('listbox');
    expect(within(resultats).getByText('Affaires')).toBeTruthy();
    expect(within(resultats).getByText('Contacts')).toBeTruthy();
    expect(within(resultats).getByText('Organisations')).toBeTruthy();
    expect(calls.at(-1)?.url).toBe('/api/i/simatis/recherche?q=vall');
    fireEvent.click(within(resultats).getByRole('option', { name: /Agathe Vallière/ }));
    expect(location.hash).toBe('#/simatis/fiche/contact/c1');
  });

  it('opens the first result with Enter', async () => {
    render(<Barre slug="simatis" />);
    const champ = screen.getByLabelText('Recherche globale');
    fireEvent.change(champ, { target: { value: 'vall' } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(champ, { key: 'Enter' });
    expect(location.hash).toBe('#/simatis/fiche/affaire/o1');
  });

  it('adds a deal from the quick-add menu, in the first stage', async () => {
    render(<Barre slug="simatis" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajout rapide' }));
    expect(screen.getByRole('menuitem', { name: 'Contact' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Organisation' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Activité' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Affaire' }));
    const modal = await screen.findByRole('dialog', { name: 'Nouvelle affaire' });
    fireEvent.change(within(modal).getByLabelText('Titre'), { target: { value: 'Audit' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/i/simatis/opportunites',
      body: { titre: 'Audit', etape: 'qualification' },
    });
    await waitFor(() => expect(location.hash).toBe('#/simatis/fiche/affaire/o9'));
  });

  it('opens the new organisation window from the menu', async () => {
    render(<Barre slug="simatis" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajout rapide' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Organisation' }));
    expect(await screen.findByRole('dialog', { name: 'Nouvelle entreprise' })).toBeTruthy();
  });

  describe('dans les mandats', () => {
    const chercher = async () => {
      fireEvent.change(screen.getByLabelText('Recherche globale'), { target: { value: 'dupont' } });
      return screen.findByRole('listbox');
    };

    it('n’offre pas la case sans le droit de transférer', async () => {
      render(<Barre slug="simatis" />);
      await chercher();
      expect(screen.queryByLabelText('Inclure les mandats')).toBeNull();
    });

    it('offre la case, décochée : aucune requête vers les mandats', async () => {
      droit = true;
      render(<Barre slug="simatis" />);
      await chercher();
      const case_ = await screen.findByLabelText('Inclure les mandats');
      expect((case_ as HTMLInputElement).checked).toBe(false);
      expect(calls.some((c) => c.url.includes('portee=mandats'))).toBe(false);
    });

    it('cochée, groupe les résultats par mandat avec leur pastille', async () => {
      droit = true;
      render(<Barre slug="simatis" />);
      const liste = await chercher();
      fireEvent.click(await screen.findByLabelText('Inclure les mandats'));
      expect(await within(liste).findByRole('option', { name: /Paul Dupont/ })).toBeTruthy();
      expect(await within(liste).findByRole('button', { name: 'Mandat A' })).toBeTruthy();
      expect(calls.map((c) => c.url)).toContain('/api/i/simatis/recherche?q=dupont&portee=mandats');
    });

    it('ouvre la fiche dans le mandat au clic sur le résultat', async () => {
      droit = true;
      render(<Barre slug="simatis" />);
      const liste = await chercher();
      fireEvent.click(await screen.findByLabelText('Inclure les mandats'));
      fireEvent.click(await within(liste).findByRole('option', { name: /Paul Dupont/ }));
      expect(location.hash).toBe('#/mandat-a/fiche/contact/c7');
    });

    it('la pastille ouvre le transfert depuis le mandat, sans ouvrir la fiche ni fermer la liste', async () => {
      droit = true;
      render(<Barre slug="simatis" />);
      const liste = await chercher();
      fireEvent.click(await screen.findByLabelText('Inclure les mandats'));
      fireEvent.click(await within(liste).findByRole('button', { name: 'Mandat A' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Mandat B' }));
      await screen.findByRole('dialog');
      const apercu = calls.find((c) => c.url.endsWith('/transfert/apercu'));
      expect(apercu?.body).toMatchObject({
        type: 'contact',
        id: 'c7',
        instanceOrigine: 'mandat-a',
        instanceCible: 'mandat-b',
      });
      expect(location.hash).toBe('');
      expect(screen.getByRole('listbox')).toBeTruthy();
    });

    it('relance la recherche après un transfert', async () => {
      droit = true;
      render(<Barre slug="simatis" />);
      const liste = await chercher();
      fireEvent.click(await screen.findByLabelText('Inclure les mandats'));
      fireEvent.click(await within(liste).findByRole('button', { name: 'Mandat A' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Mandat B' }));
      await screen.findByRole('dialog');
      const avant = calls.filter((c) => c.url.includes('portee=mandats')).length;
      fireEvent.click(await screen.findByRole('button', { name: 'Confirmer' }));
      await waitFor(() =>
        expect(calls.filter((c) => c.url.includes('portee=mandats')).length).toBeGreaterThan(avant),
      );
    });
  });
});
