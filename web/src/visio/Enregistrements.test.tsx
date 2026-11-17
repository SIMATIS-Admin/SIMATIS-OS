// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Enregistrements } from './Enregistrements.js';

let liste: object[];
const ligne = (extra: object) => ({
  id: 's1',
  rdvId: 'os:v1',
  titre: 'V - Atelier Fictif x Simatis',
  debutAt: '2026-10-12T08:00:00.000Z',
  finAt: '2026-10-12T08:30:00.000Z',
  statut: 'transcrit',
  aResume: false,
  ...extra,
});

describe('Enregistrements', () => {
  beforeEach(() => {
    liste = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(liste)))),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('ne montre rien tant qu’il n’y a aucun enregistrement', async () => {
    const { container } = render(<Enregistrements slug="simatis" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('liste les enregistrements avec leur état et un lien vers la fiche', async () => {
    liste = [
      ligne({ id: 'a', statut: 'en_cours', finAt: null }),
      ligne({ id: 'b', titre: 'Enregistrement du 12/10/2026 à 10h00', aResume: true }),
    ];
    render(<Enregistrements slug="simatis" />);
    expect(await screen.findByText('En cours')).toBeTruthy();
    expect(screen.getByText('Résumé prêt')).toBeTruthy();
    const lien = screen.getByRole('link', { name: /Enregistrement du 12\/10\/2026 à 10h00/ });
    expect(lien.getAttribute('href')).toBe('#/simatis/fiche/rdv/os%3Av1');
  });

  it('distingue la transcription en cours d’une transcription terminée', async () => {
    liste = [ligne({ id: 'c', statut: 'clos' }), ligne({ id: 'd', statut: 'transcrit' })];
    render(<Enregistrements slug="simatis" />);
    expect(await screen.findByText('Transcription en cours')).toBeTruthy();
    expect(screen.getByText('Transcrit')).toBeTruthy();
  });
});
