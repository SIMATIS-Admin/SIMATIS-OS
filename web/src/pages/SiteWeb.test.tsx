// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EtatSiteWeb, RapportSite } from '../api.js';
import { SiteWeb } from './SiteWeb.js';

const indic = (visiteurs: number, sessions: number) => ({
  visiteurs,
  nouveaux: visiteurs - 50,
  sessions,
  engagement: 0.6,
  dureeMoyenne: 95,
  pagesVues: sessions * 2,
});
const rapport: RapportSite = {
  periode: { du: '2026-09-16', au: '2026-10-13' },
  precedente: { du: '2026-08-19', au: '2026-09-15' },
  actuel: indic(240, 300),
  precedent: indic(200, 260),
  demandes: { actuel: 3, precedent: 3 },
  mois: [
    { mois: '2026-09', visiteurs: 230, sessions: 290 },
    { mois: '2026-10', visiteurs: 110, sessions: 130 },
  ],
  canaux: [{ canal: 'Recherche Google et autres moteurs', sessions: 150, engagement: 0.7 }],
  pages: [{ chemin: '/diagnostic', titre: 'Diagnostic fictif', vues: 120, visiteurs: 80 }],
  sources: [{ source: '(direct)', sessions: 90 }],
  genereLe: '2026-10-14T08:00:00Z',
};

function serveur(etat: EtatSiteWeb, proprietes: unknown[] = []) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b)));
      if (url.endsWith('/site-web')) return json(etat);
      if (url.endsWith('/site-web/proprietes')) return json(proprietes);
      if (url.includes('/site-web/rapport')) return json(rapport);
      if (url.endsWith('/site-web/temps-reel'))
        return json({
          visiteurs: 4,
          parMinute: Array.from({ length: 30 }, (_, k) => (k === 29 ? 4 : 0)),
          pages: [{ titre: 'Accueil en direct', visiteurs: 3 }],
          genereLe: '2026-10-14T08:00:00Z',
        });
      if (url.endsWith('/site-web/google/start')) return json({ url: '#consentement' });
      return json({});
    }),
  );
  return calls;
}

describe('Site web screen', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers to connect a Google Analytics account first', async () => {
    const calls = serveur({ googleClientDisponible: true, connecte: false, propriete: null });
    render(<SiteWeb slug="simatis" />);
    fireEvent.click(await screen.findByText('Connecter le compte Google Analytics'));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/google/start'))).toBe(true),
    );
  });

  it('says when the account sees no website', async () => {
    serveur({ googleClientDisponible: true, connecte: true, propriete: null }, []);
    render(<SiteWeb slug="simatis" />);
    expect(await screen.findByText(/n'a accès à aucun site/)).toBeTruthy();
    expect(screen.getByText('Utiliser un autre compte Google')).toBeTruthy();
  });

  it('offers to reconnect when the websites cannot be read', async () => {
    serveur({ googleClientDisponible: true, connecte: true, propriete: null });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith('/site-web')
            ? new Response(
                JSON.stringify({ googleClientDisponible: true, connecte: true, propriete: null }),
              )
            : new Response(JSON.stringify({ error: 'Autorisation expirée' }), { status: 409 }),
        ),
      ),
    );
    render(<SiteWeb slug="simatis" />);
    expect(await screen.findByText('Autorisation expirée')).toBeTruthy();
    expect(screen.getByText('Reconnecter le compte Google')).toBeTruthy();
  });

  it('shows the figures with their change against the previous 28 days', async () => {
    serveur({
      googleClientDisponible: true,
      connecte: true,
      propriete: { proprieteId: '1', proprieteNom: 'Site fictif' },
    });
    render(<SiteWeb slug="simatis" />);
    const visiteurs = (await screen.findAllByText('Visiteurs'))
      .map((e) => e.closest('.kpi'))
      .find(Boolean);
    expect(visiteurs?.textContent).toMatch(/240.*▲ \+20 % vs 28 j précédents/);
    const demandes = screen.getByText('Demandes reçues par le formulaire').closest('.kpi');
    expect(demandes?.textContent).toMatch(/3.*stable/);
    expect(screen.getByText('Recherche Google et autres moteurs')).toBeTruthy();
    expect(screen.getByText('Diagnostic fictif')).toBeTruthy();
    expect(screen.getByText('Accès direct')).toBeTruthy();
    expect(screen.getByLabelText(/oct\. 2026 : 110 visiteurs.*mois en cours/)).toBeTruthy();
  });

  it('shows who is on the site right now and refreshes it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const calls = serveur({
        googleClientDisponible: true,
        connecte: true,
        propriete: { proprieteId: '1', proprieteNom: 'Site fictif' },
      });
      render(<SiteWeb slug="simatis" />);
      expect(await screen.findByText('Accueil en direct')).toBeTruthy();
      expect(screen.getByText('Visiteurs actifs').closest('.kpi')?.textContent).toMatch(/4$/);
      const lectures = () => calls.filter((c) => c.url.endsWith('/site-web/temps-reel')).length;
      const avant = lectures();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(lectures()).toBeGreaterThan(avant);
    } finally {
      vi.useRealTimers();
    }
  });
});
