// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CarteOutils } from './CarteOutils.js';
import * as api from '../../api.js';
vi.mock('../../api.js', () => ({
  fetchProjetsDiag: vi.fn(),
  fetchTestsVma: vi.fn(),
  fetchRendezVous: vi.fn(),
  majProjetDiag: vi.fn(),
  rattacherVma: vi.fn(),
  lierRdv: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

for (const kind of ['affaire', 'entreprise', 'contact'] as const) {
  const cle =
    kind === 'affaire' ? 'opportuniteId' : kind === 'contact' ? 'contactId' : 'entrepriseId';
  describe(`Liens depuis une fiche ${kind}`, () => {
    for (const type of ['diagnostic', 'vma', 'rdv'] as const) {
      it(`lie un ${type} existant et recharge la fiche`, async () => {
        vi.mocked(api.fetchProjetsDiag).mockResolvedValue([
          { id: 'outil', nom: 'Diagnostic fictif' },
        ] as never);
        vi.mocked(api.fetchTestsVma).mockResolvedValue([
          { id: 'outil', entrepriseNom: 'Entreprise fictive', creeLe: '2026-01-01' },
        ] as never);
        vi.mocked(api.fetchRendezVous).mockResolvedValue({
          etat: 'ok',
          rdv: [{ id: 'outil', titre: 'Réunion fictive', debut: '2026-01-01', statut: 'rdv' }],
        } as never);
        const onChange = vi.fn();
        render(
          <CarteOutils
            slug="demo"
            type={type}
            titre="Outils"
            de={{ kind, id: 'fiche' }}
            lignes={[]}
            onChange={onChange}
            onMessage={vi.fn()}
          />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Lier un/ }));
        fireEvent.change(await screen.findByLabelText('Choisir dans Outils'), {
          target: { value: 'outil' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Lier à cette fiche' }));
        await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
        if (type === 'rdv')
          expect(api.lierRdv).toHaveBeenCalledWith('demo', 'outil', { kind, id: 'fiche' }, false);
        else
          expect(type === 'vma' ? api.rattacherVma : api.majProjetDiag).toHaveBeenCalledWith(
            'demo',
            'outil',
            { [cle]: 'fiche' },
          );
      });
    }
  });
}
it('avertit avant de remplacer un rattachement existant', async () => {
  vi.mocked(api.fetchProjetsDiag).mockResolvedValue([
    { id: 'd', nom: 'Diagnostic fictif', entrepriseId: 'autre' },
  ] as never);
  render(
    <CarteOutils
      slug="demo"
      type="diagnostic"
      titre="Diagnostics"
      de={{ kind: 'entreprise', id: 'fiche' }}
      lignes={[]}
      onChange={vi.fn()}
      onMessage={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lier un diagnostic' }));
  fireEvent.change(await screen.findByLabelText('Choisir dans Diagnostics'), {
    target: { value: 'd' },
  });
  expect(screen.getByRole('button', { name: 'Remplacer le lien' })).toBeTruthy();
  expect(api.majProjetDiag).not.toHaveBeenCalled();
});
it('conserve la fiche et affiche l’erreur si la sauvegarde échoue', async () => {
  vi.mocked(api.lierRdv).mockRejectedValue(new Error('Échec fictif'));
  const onChange = vi.fn();
  const onMessage = vi.fn();
  render(
    <CarteOutils
      slug="demo"
      type="rdv"
      titre="Rendez-vous"
      de={{ kind: 'affaire', id: 'fiche' }}
      lignes={[{ id: 'r', nom: 'RDV fictif', href: '#' }]}
      onChange={onChange}
      onMessage={onMessage}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Délier RDV fictif' }));
  await waitFor(() => expect(onMessage).toHaveBeenCalledWith('Échec fictif'));
  expect(onChange).not.toHaveBeenCalled();
});
