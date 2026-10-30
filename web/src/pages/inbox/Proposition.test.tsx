// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropositionItem } from '../../api.js';
import { PropositionDetail } from './Proposition.js';

const base: Omit<PropositionItem, 'type' | 'contenu'> = {
  id: 'p-1',
  auteur: 'agent:claude-marc',
  statut: 'proposee',
  niveau: 'L2',
  decidePar: null,
  resultat: null,
  createdAt: '2026-10-30T08:00:00Z',
  action: null,
  contact: null,
};

describe('Inbox : proposition pour un OS partenaire', () => {
  afterEach(cleanup);

  it('shows the instruction of a mission and sends it on validation', () => {
    const onDecide = vi.fn();
    render(
      <PropositionDetail
        p={{
          ...base,
          type: 'partenaire.mission',
          contenu: { titre: 'Livre blanc (essai)', consigne: 'Un livre blanc fictif' },
        }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText('Livre blanc (essai)')).toBeTruthy();
    expect(screen.getByText('Un livre blanc fictif')).toBeTruthy();
    fireEvent.click(screen.getByText('Envoyer au partenaire'));
    expect(onDecide).toHaveBeenCalledWith('valider', undefined);
  });

  it('names a fact by what it sends and lists its fields', () => {
    render(
      <PropositionDetail
        p={{
          ...base,
          type: 'partenaire.donnee',
          contenu: {
            objet: 'affaire',
            evenement: 'gagne',
            ref: 'affaire-fictive',
            champs: { entreprise: 'Entreprise fictive' },
          },
        }}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText('Envoyer à un partenaire : affaire gagne')).toBeTruthy();
    expect(screen.getByText('Entreprise fictive')).toBeTruthy();
  });
});
