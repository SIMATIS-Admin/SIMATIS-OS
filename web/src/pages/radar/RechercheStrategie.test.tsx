// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CiblageAtelier } from '../../api.js';

vi.mock('../RechercheEntreprises.js', () => ({
  RechercheEntreprises: ({
    demandeInitiale,
    etiquette,
  }: {
    demandeInitiale?: string;
    etiquette?: string;
  }) => (
    <p>
      Recherche avec : {demandeInitiale} / étiquette : {etiquette}
    </p>
  ),
}));

import { etiquetteIcp, RechercheStrategie } from './RechercheStrategie.js';

const icp = (code: string, demande: string): CiblageAtelier => ({
  atelierId: 'a1',
  atelierTitre: 'Atelier fictif',
  entreprise: 'Entreprise Fictive',
  code,
  nom: `Nom ${code}`,
  offre: '',
  icp: [{ cle: 'Catégorie', valeur: 'PME' }],
  persona: [{ cle: 'Poste', valeur: 'Dirigeant' }],
  demande,
});
const repondre = (corps: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(corps), { status }))),
  );

describe('RechercheStrategie', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("propose les ICP de l'Atelier avec la demande composée, et ouvre la recherche préremplie", async () => {
    repondre([icp('ICP A', 'Entreprises : PME'), icp('ICP B', 'Entreprises : ETI')]);
    render(<RechercheStrategie slug="simatis" onAjoute={vi.fn()} />);
    expect(await screen.findByLabelText('Demande composée')).toBeTruthy();
    expect(screen.getByLabelText('Demande composée').textContent).toBe('Entreprises : PME');
    fireEvent.change(screen.getByLabelText('ICP à cibler'), { target: { value: '1' } });
    expect(screen.getByLabelText('Demande composée').textContent).toBe('Entreprises : ETI');
    fireEvent.click(screen.getByRole('button', { name: 'Chercher selon cet ICP' }));
    expect(
      screen.getByText(
        'Recherche avec : Entreprises : ETI / étiquette : icp B (Entreprise Fictive)',
      ),
    ).toBeTruthy();
  });

  it("compose l'étiquette de l'ICP avec l'entreprise de l'atelier, sans dépasser 40 caractères", () => {
    expect(etiquetteIcp({ code: 'ICP A', entreprise: 'SIMATIS' })).toBe('icp A (SIMATIS)');
    expect(etiquetteIcp({ code: 'ICP C', entreprise: null })).toBe('icp C');
    expect(
      etiquetteIcp({ code: 'ICP A', entreprise: 'Une entreprise au nom vraiment très long' }),
    ).toHaveLength(40);
  });

  it("invite à remplir l'Atelier quand aucun ICP n'est renseigné", async () => {
    repondre([]);
    render(<RechercheStrategie slug="simatis" onAjoute={vi.fn()} />);
    expect(await screen.findByText(/Aucun ICP renseigné/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Ouvrir l’Atelier stratégique' }).getAttribute('href'),
    ).toBe('#/simatis/atelier');
  });

  it("n'affiche rien dans un espace sans Atelier", async () => {
    repondre({ error: 'Atelier non activé' }, 403);
    const { container } = render(<RechercheStrategie slug="mandat" onAjoute={vi.fn()} />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
