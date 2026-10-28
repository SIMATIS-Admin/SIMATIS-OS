// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ciblage } from './Ciblage.js';
import { etatVide, type EtatAtelier } from './etat.js';
import { FeuilleDeRoute } from './FeuilleDeRoute.js';

function Banc({
  initial,
  partage = true,
  Etape,
  extra,
}: {
  initial: EtatAtelier;
  partage?: boolean;
  Etape: typeof Ciblage | typeof FeuilleDeRoute;
  extra?: Record<string, unknown>;
}) {
  const [etat, setEtat] = useState(initial);
  const E = Etape as React.ComponentType<Record<string, unknown>>;
  return (
    <>
      <E
        etat={etat}
        partage={partage}
        onChange={(p: Partial<EtatAtelier>) => setEtat((e) => ({ ...e, ...p }))}
        {...extra}
      />
      <pre data-testid="etat">{JSON.stringify(etat)}</pre>
    </>
  );
}
const lu = () => JSON.parse(screen.getByTestId('etat').textContent ?? '{}') as EtatAtelier;

const deuxIcps = (): EtatAtelier => {
  const e = etatVide();
  return { ...e, icps: [...e.icps, { ...e.icps[0]!, code: 'ICP B' }] };
};

describe('Étape Ciblage', () => {
  afterEach(() => cleanup());

  it('changer d’ICP et retenir une piste met l’état à jour', () => {
    render(<Banc initial={deuxIcps()} Etape={Ciblage} />);
    fireEvent.click(screen.getByRole('button', { name: /ICP B/ }));
    expect(lu().icp).toBe(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retenir' })[0]!);
    expect(lu().pistes[0]!.on).toBe(true);
  });

  it('saisit un champ de l’ICP et du persona', () => {
    render(<Banc initial={etatVide()} Etape={Ciblage} />);
    fireEvent.change(screen.getByLabelText('ICP : Catégorie'), {
      target: { value: 'PME fictives' },
    });
    fireEvent.change(screen.getByLabelText('Persona : Poste'), { target: { value: 'Dirigeant' } });
    expect(lu().icps[0]!.icp[0]).toBe('PME fictives');
    expect(lu().icps[0]!.persona[0]).toBe('Dirigeant');
  });

  it('ajoute puis supprime un ICP, en gardant au moins un', () => {
    render(<Banc initial={etatVide()} Etape={Ciblage} />);
    expect(screen.queryByRole('button', { name: 'Supprimer cet ICP' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un ICP' }));
    expect(lu().icps).toHaveLength(2);
    expect(lu().icp).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer cet ICP' }));
    expect(lu().icps).toHaveLength(1);
    expect(lu().icp).toBe(0);
  });
});

describe('Étape Feuille de route', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const ctx = (telecharger = vi.fn()) => ({ entreprise: 'Entreprise Fictive', telecharger });

  it('ajoute, écarte et supprime une action dans son trimestre', () => {
    render(<Banc initial={etatVide()} Etape={FeuilleDeRoute} extra={ctx()} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ajouter une action' })[1]!);
    expect(lu().actions).toEqual([expect.objectContaining({ q: 1, on: true })]);
    fireEvent.click(screen.getByRole('button', { name: 'Retenue' }));
    expect(lu().actions[0]!.on).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer l’action' }));
    expect(lu().actions).toHaveLength(0);
  });

  it('le téléchargement JSON passe l’écran partagé à l’export : pas de commission', () => {
    const telecharger = vi.fn();
    render(<Banc initial={etatVide()} Etape={FeuilleDeRoute} extra={ctx(telecharger)} />);
    fireEvent.click(screen.getByRole('button', { name: /Télécharger la feuille de route/ }));
    const [nom, texte, mime] = telecharger.mock.calls[0] as [string, string, string];
    expect(nom).toMatch(/\.json$/);
    expect(mime).toBe('application/json');
    expect(texte).not.toContain('commission');
    expect(JSON.parse(texte)).toMatchObject({ entreprise: 'Entreprise Fictive' });
  });

  it('hors écran partagé, le JSON porte la commission', () => {
    const telecharger = vi.fn();
    render(
      <Banc initial={etatVide()} partage={false} Etape={FeuilleDeRoute} extra={ctx(telecharger)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Télécharger la feuille de route/ }));
    expect((telecharger.mock.calls[0] as string[])[1]).toContain('commission_marc');
  });

  it('le téléchargement Markdown porte la date de l’atelier dans le nom', () => {
    const telecharger = vi.fn();
    const initial = { ...etatVide(), date: '2026-10-27' };
    render(<Banc initial={initial} Etape={FeuilleDeRoute} extra={ctx(telecharger)} />);
    fireEvent.click(screen.getByRole('button', { name: /Télécharger la fiche de cadrage/ }));
    expect((telecharger.mock.calls[0] as string[])[0]).toBe('2026-10-27_Cadrage_strategique.md');
  });

  it('copie la fiche dans le presse-papiers et signale un refus', async () => {
    const ecrire = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('non'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: ecrire },
      configurable: true,
    });
    render(<Banc initial={etatVide()} Etape={FeuilleDeRoute} extra={ctx()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copier la fiche' }));
    expect(await screen.findByText('Fiche copiée')).toBeTruthy();
    expect(ecrire.mock.calls[0]![0]).toContain('status: draft');
    fireEvent.click(screen.getByRole('button', { name: 'Copier la fiche' }));
    await waitFor(() => expect(screen.getByText(/Copie refusée/)).toBeTruthy());
  });
});
