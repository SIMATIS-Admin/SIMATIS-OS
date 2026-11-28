// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lireOrganigramme } from '../feuilleDeRouteOS.js';
import type { InstanceSummary } from '../nav.js';
import { OrganigrammeGraphique } from './OrganigrammeGraphique.js';

const base = { sous: '', phase: null, couleur: '#000' } as const;
const instances: InstanceSummary[] = [
  {
    ...base,
    slug: 'moi',
    nom: 'Espace fictif',
    type: 'propre',
    modules: ['cerveau', 'gestion'],
  },
  { ...base, slug: 'm', nom: 'Mandat fictif', type: 'mandat', phase: 'en_cours', modules: [] },
];
const rubriques = lireOrganigramme(
  [
    '## Vendre',
    '- Pipeline [en service] — étapes fictives',
    '  - Fonction fictive [à essayer] — détail fictif',
    '## Piloter l’activité',
    '- Gestion [en service] — comptes fictifs',
  ].join('\n'),
);

const json = (corps: unknown) => new Response(JSON.stringify(corps), { status: 200 });
beforeEach(() =>
  vi.stubGlobal('fetch', (url: string) => {
    const mandat = url.includes('/api/i/m/');
    if (url.endsWith('/connexions'))
      return Promise.resolve(
        json({
          connexions: mandat
            ? [{ kind: 'crm', fournisseur: 'hubspot', etat: 'erreur', reglages: {} }]
            : [{ kind: 'messagerie', fournisseur: 'gmail', etat: 'ok', reglages: {} }],
          secondeBoite: false,
          ecrituresReelles: false,
        }),
      );
    if (url.endsWith('/partenaires'))
      return Promise.resolve(
        json({
          actif: true,
          porteuse: mandat,
          niveaux: [],
          partenaires: mandat
            ? [{ id: '1', nom: 'Partenaire fictif', statut: 'active', niveau: 'L1' }]
            : [],
        }),
      );
    return Promise.resolve(new Response('{}', { status: 500 }));
  }),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  location.hash = '';
});

const monter = () =>
  render(<OrganigrammeGraphique rubriques={rubriques} instances={instances} slug="moi" />);
const detail = (nom: string) => screen.getByRole('region', { name: `Détail : ${nom}` });

describe('OrganigrammeGraphique', () => {
  it('ouvre une section par son bouton, dans l’instance affichée', () => {
    monter();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Pipeline' }));
    expect(location.hash).toBe('#/moi/pipeline');
    fireEvent.click(screen.getByRole('button', { name: 'Mandat fictif' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Pipeline' }));
    expect(location.hash).toBe('#/m/pipeline');
  });

  it('explique en bas et propose le même bouton, aussi pour une sous-fonction', () => {
    monter();
    fireEvent.click(screen.getByRole('button', { name: /^Pipeline/ }));
    expect(detail('Pipeline').textContent).toContain('étapes fictives');
    fireEvent.click(within(detail('Pipeline')).getByRole('button', { name: /^Fonction fictive/ }));
    fireEvent.click(
      within(detail('Fonction fictive')).getByRole('button', {
        name: /^Ouvrir la section Pipeline/,
      }),
    );
    expect(location.hash).toBe('#/moi/pipeline');
  });

  it('grise la gestion hors de Mon activité et dit pourquoi', () => {
    monter();
    expect(screen.getByRole('button', { name: 'Ouvrir Gestion' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Gestion/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mandat fictif' }));
    expect(screen.queryByRole('button', { name: 'Ouvrir Gestion' })).toBeNull();
    expect(detail('Gestion').textContent).toContain('Réservé à Mon activité');
    expect(within(detail('Gestion')).queryByRole('button', { name: /Ouvrir/ })).toBeNull();
  });

  it('suit les connexions et le relais de l’instance choisie', async () => {
    monter();
    expect(await screen.findByRole('button', { name: /Gmail.*branché/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mandat fictif' }));
    fireEvent.click(await screen.findByRole('button', { name: /HubSpot.*en erreur/ }));
    expect(detail('HubSpot').textContent).toContain('lecture seule');
    fireEvent.click(within(detail('HubSpot')).getByRole('button', { name: /Ouvrir la section/ }));
    expect(location.hash).toBe('#/m/parametres');
    expect(await screen.findByText('Partenaire fictif · autonomie : L1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Gmail.*branché/ })).toBeNull();
  });

  it('détaille le moteur et reste lisible quand une lecture échoue', async () => {
    monter();
    fireEvent.click(await screen.findByRole('button', { name: /Double verrou.*fermé/ }));
    expect(detail('Double verrou').textContent).toContain('simulée');
    expect(screen.getByRole('button', { name: /^Routines/ })).toBeTruthy();
  });
});
