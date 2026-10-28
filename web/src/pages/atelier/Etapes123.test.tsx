// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentType } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Cadrage } from './Cadrage.js';
import { EtapeDiagnostic } from './EtapeDiagnostic.js';
import { etatVide, type EtatAtelier } from './etat.js';
import { Modele } from './Modele.js';

type Props = {
  etat: EtatAtelier;
  partage: boolean;
  onChange: (patch: Partial<EtatAtelier>) => void;
};

// Un atelier minimal qui garde l'état comme le fait l'atelier ouvert, pour lire le résultat.
function Banc({
  initial,
  partage,
  Etape,
}: {
  initial: EtatAtelier;
  partage: boolean;
  Etape: ComponentType<Props>;
}) {
  const [etat, setEtat] = useState(initial);
  return (
    <>
      <Etape etat={etat} partage={partage} onChange={(p) => setEtat((e) => ({ ...e, ...p }))} />
      <pre data-testid="etat">{JSON.stringify(etat)}</pre>
    </>
  );
}
const lu = () => JSON.parse(screen.getByTestId('etat').textContent ?? '{}') as EtatAtelier;

const avecFaits = (): EtatAtelier => ({
  ...etatVide(),
  facts: [
    { k: 'Public', v: 'Visible', tag: 'fait', src: 's' },
    { k: 'Réservé', v: 'Secret fictif', tag: 'decl', src: 's', prive: true },
  ],
});

describe('Étape Cadrage', () => {
  afterEach(() => cleanup());

  it('un fait privé n’est pas affiché en écran partagé, et l’est sinon', () => {
    const { unmount } = render(<Banc initial={avecFaits()} partage Etape={Cadrage} />);
    expect(screen.getByDisplayValue('Visible')).toBeTruthy();
    expect(screen.queryByDisplayValue('Secret fictif')).toBeNull();
    unmount();
    render(<Banc initial={avecFaits()} partage={false} Etape={Cadrage} />);
    expect(screen.getByDisplayValue('Secret fictif')).toBeTruthy();
  });

  it('ajouter puis supprimer un fait met l’état à jour', () => {
    render(<Banc initial={etatVide()} partage Etape={Cadrage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une information' }));
    expect(lu().facts).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer l’information' }));
    expect(lu().facts).toHaveLength(0);
  });

  it('la nature d’un fait se change', () => {
    render(<Banc initial={avecFaits()} partage Etape={Cadrage} />);
    fireEvent.change(screen.getByLabelText('Nature de l’information'), {
      target: { value: 'hyp' },
    });
    expect(lu().facts[0]!.tag).toBe('hyp');
  });

  it('la case « réservé » n’existe qu’hors écran partagé et marque le fait', () => {
    const { unmount } = render(<Banc initial={avecFaits()} partage Etape={Cadrage} />);
    expect(screen.queryByLabelText('Réservé')).toBeNull();
    unmount();
    render(<Banc initial={avecFaits()} partage={false} Etape={Cadrage} />);
    fireEvent.click(screen.getAllByLabelText('Réservé')[0]!);
    expect(lu().facts[0]!.prive).toBe(true);
  });
});

describe('Étape Diagnostic', () => {
  afterEach(() => cleanup());

  it('garde l’état du diagnostic, du test VMA et leurs notes', () => {
    render(<Banc initial={etatVide()} partage Etape={EtapeDiagnostic} />);
    fireEvent.change(screen.getByLabelText('Diagnostic d’endurance'), {
      target: { value: 'fait' },
    });
    fireEvent.change(screen.getByLabelText('Test de VMA'), { target: { value: 'passe' } });
    fireEvent.change(screen.getByLabelText('Effectif'), { target: { value: '12 personnes' } });
    expect(lu()).toMatchObject({
      diag: 'fait',
      vma: 'passe',
      identity: { effectif: '12 personnes' },
    });
  });
});

describe('Étape Modèle', () => {
  afterEach(() => cleanup());

  it('choisir un scénario et une offre met l’état à jour', () => {
    render(<Banc initial={etatVide()} partage Etape={Modele} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retenir' })[0]!);
    expect(lu().scen).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Offre 3/ }));
    expect(lu().motor).toBe(2);
  });

  it('saisir le chiffre d’affaires d’un scénario', () => {
    render(<Banc initial={etatVide()} partage Etape={Modele} />);
    fireEvent.change(screen.getAllByLabelText('CA sur 12 mois (€)')[2]!, {
      target: { value: '90000' },
    });
    expect(lu().scenarios[2]!.ca).toBe('90000');
  });

  it('ajouter une ligne au SWOT puis la supprimer', () => {
    render(<Banc initial={etatVide()} partage Etape={Modele} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ajouter' })[0]!);
    expect(lu().swot[0]!.items).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer cette ligne' }));
    expect(lu().swot[0]!.items).toHaveLength(0);
  });
});
