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

  it('names a free message by its subject and shows its text', () => {
    render(
      <PropositionDetail
        p={{
          ...base,
          type: 'partenaire.message',
          contenu: {
            partenaire: 'Alpes OS · Essai',
            type: 'question',
            sujet: 'Atelier fictif',
            texte: 'Le compte rendu fictif est prêt.',
          },
        }}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText('Message à Alpes OS · Essai : Atelier fictif')).toBeTruthy();
    expect(screen.getByText('Le compte rendu fictif est prêt.')).toBeTruthy();
  });

  it('accepts or refuses a mission received from a partner', () => {
    const onDecide = vi.fn();
    render(
      <PropositionDetail
        p={{
          ...base,
          niveau: 'L1',
          auteur: 'partenaire:connexion-fictive',
          type: 'partenaire.mission_recue',
          contenu: {
            missionId: 'mission-fictive',
            partenaire: 'Alpes OS',
            titre: 'Alpes OS vous confie « Atelier (essai) »',
            consigne: 'Préparer un atelier fictif',
          },
        }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText('Alpes OS vous confie « Atelier (essai) »')).toBeTruthy();
    expect(screen.getByText('Préparer un atelier fictif')).toBeTruthy();
    fireEvent.click(screen.getByText('Accepter la mission'));
    expect(onDecide).toHaveBeenCalledWith('valider', undefined);
    fireEvent.click(screen.getByText('Refuser'));
    expect(onDecide).toHaveBeenLastCalledWith('ecarter');
  });
});
