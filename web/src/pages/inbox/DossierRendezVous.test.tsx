// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DossierRdv, SujetVue } from '../../api.js';
import { DossierRendezVous } from './DossierRendezVous.js';

const camille = {
  contactId: 'c-1',
  nom: 'Camille Fictive',
  entreprise: 'Entreprise Fictive',
  principal: true,
};
const dossier = (extra: Partial<DossierRdv> = {}): DossierRdv => ({
  sessionVisioId: 'v-1',
  sourceRdvEventId: 'os:1',
  rdv: { eventId: 'ev-1', titre: 'Diagnostic fictif', debut: '2026-11-20T10:00:00Z' },
  rdvCertain: true,
  candidats: [],
  interlocuteurs: [camille],
  ...extra,
});
const sujet = (
  d: DossierRdv,
  texte = '**Contexte** : première visio fictive.\n- Point un\n- Point deux',
) =>
  ({
    id: 's-1',
    contact: null,
    compteRenduPrepare: { texte, prepareeLe: '2026-11-20T10:00:00Z', dossier: d },
  }) as unknown as SujetVue;
const monte = (s: SujetVue, onAcquitter = vi.fn()) => {
  render(<DossierRendezVous slug="simatis" s={s} onAcquitter={onAcquitter} />);
  return onAcquitter;
};

describe('DossierRendezVous', () => {
  afterEach(cleanup);

  it('montre trois zones : Déjà fait, Compte rendu, À l’acquittement', () => {
    monte(sujet(dossier()));
    expect(screen.getByRole('heading', { name: 'Déjà fait' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Compte rendu' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /À l’acquittement/ })).toBeTruthy();
  });

  it('rendez-vous certain : une ligne avec son titre', () => {
    monte(sujet(dossier()));
    expect(screen.getByText(/Rendez-vous de l’agenda/).textContent).toContain('Diagnostic fictif');
  });

  it('rendez-vous incertain : « à choisir », candidats listés, rien de sélectionné', () => {
    const onAcquitter = monte(
      sujet(
        dossier({
          rdv: null,
          rdvCertain: false,
          candidats: [
            { eventId: 'ev-a', titre: 'Premier fictif', debut: null },
            { eventId: 'ev-b', titre: 'Second fictif', debut: null },
          ],
        }),
      ),
    );
    expect(screen.getByText(/Rendez-vous à choisir/)).toBeTruthy();
    const liste = screen.getByLabelText<HTMLSelectElement>('Rendez-vous du compte rendu');
    expect(liste.value).toBe('');
    expect(within(liste).getAllByRole('option')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Acquitter' }));
    expect(onAcquitter.mock.calls[0]?.[0]).not.toHaveProperty('eventId');
  });

  it('un interlocuteur reconnu est proposé avec son nom et son entreprise', () => {
    monte(sujet(dossier()));
    const liste = screen.getByLabelText<HTMLSelectElement>('Interlocuteur du rendez-vous');
    expect(liste.selectedOptions[0]?.textContent).toBe('Camille Fictive (Entreprise Fictive)');
  });

  it('plusieurs interlocuteurs : le principal d’abord, et le choix change le contact envoyé', () => {
    const robin = { contactId: 'c-2', nom: 'Robin Fictif', entreprise: null, principal: false };
    const onAcquitter = monte(sujet(dossier({ interlocuteurs: [camille, robin] })));
    const liste = screen.getByLabelText<HTMLSelectElement>('Interlocuteur du rendez-vous');
    expect(within(liste).getAllByRole('option')[0]?.textContent).toContain('Camille Fictive');
    fireEvent.change(liste, { target: { value: 'c-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Acquitter' }));
    expect(onAcquitter.mock.calls[0]?.[0]).toMatchObject({ contactId: 'c-2' });
  });

  it('Changer propose les rendez-vous de l’agenda proches de l’entrée', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                eventId: 'ev-9',
                titre: 'Autre rendez-vous fictif',
                debut: null,
                compteRendu: false,
                propose: false,
              },
            ]),
          ),
        ),
      ),
    );
    monte(sujet(dossier()));
    fireEvent.click(screen.getByRole('button', { name: 'Changer' }));
    expect(await screen.findByRole('option', { name: /Autre rendez-vous fictif/ })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('rend le compte rendu en titres et listes, sans ** visibles', () => {
    monte(
      sujet(
        dossier(),
        '## Résumé\nTexte avec **gras** fictif.\n\n## Actions à effectuer\n- Faire un point\n- Envoyer un mail',
      ),
    );
    const zone = screen.getByTestId('compte-rendu-rendu');
    expect(zone.textContent).not.toContain('**');
    expect(within(zone).getByRole('heading', { name: 'Résumé' })).toBeTruthy();
    expect(within(zone).getAllByRole('listitem')).toHaveLength(2);
    expect(zone.querySelector('strong')?.textContent).toBe('gras');
  });

  it('un texte sans retours à la ligne reste lisible, sans ** visibles', () => {
    monte(
      sujet(
        dossier(),
        '**Contexte** : première visio fictive. **Points abordés** - Leur activité : analyse fictive. - Leur structure : une marque. **Décisions** - Il choisit le diagnostic.',
      ),
    );
    const zone = screen.getByTestId('compte-rendu-rendu');
    expect(zone.textContent).not.toContain('**');
    expect(within(zone).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
  });

  it('Modifier ouvre le texte brut ; le texte corrigé est celui envoyé', () => {
    const onAcquitter = monte(sujet(dossier(), 'Elle est venue.'));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Compte rendu'), {
      target: { value: 'Elle a répondu.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Acquitter' }));
    expect(onAcquitter.mock.calls[0]?.[0]).toMatchObject({ texte: 'Elle a répondu.' });
  });

  it('Acquitter envoie rendez-vous, texte, note du second cerveau et contact ; décocher retire la note', () => {
    const onAcquitter = monte(sujet(dossier(), 'Texte fictif.'));
    fireEvent.click(screen.getByRole('button', { name: 'Acquitter' }));
    expect(onAcquitter).toHaveBeenCalledWith({
      eventId: 'ev-1',
      texte: 'Texte fictif.',
      cerveau: true,
      contactId: 'c-1',
    });
    cleanup();
    const autre = monte(sujet(dossier(), 'Texte fictif.'));
    fireEvent.click(screen.getByLabelText('Écrire dans le second cerveau'));
    fireEvent.click(screen.getByRole('button', { name: 'Acquitter' }));
    expect(autre.mock.calls[0]?.[0]).toMatchObject({ cerveau: false });
  });

  it('le bouton se désactive après le clic : pas de double envoi', () => {
    const onAcquitter = monte(sujet(dossier()));
    const bouton = screen.getByRole('button', { name: 'Acquitter' });
    fireEvent.click(bouton);
    fireEvent.click(bouton);
    expect(onAcquitter).toHaveBeenCalledTimes(1);
  });

  it('si l’acquittement échoue, le bouton redevient disponible pour réessayer', async () => {
    const onAcquitter = vi.fn(() => Promise.resolve());
    monte(sujet(dossier()), onAcquitter);
    fireEvent.click(screen.getByRole('button', { name: 'Acquitter' }));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Acquitter' }).disabled).toBe(
        false,
      ),
    );
  });

  it('l’interlocuteur peut être écarté avec « Aucun »', () => {
    const onAcquitter = monte(sujet(dossier()));
    fireEvent.change(screen.getByLabelText('Interlocuteur du rendez-vous'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Acquitter' }));
    expect(onAcquitter.mock.calls[0]?.[0]).toMatchObject({ contactId: null });
  });

  it('un dossier vide n’empêche pas d’acquitter', () => {
    const onAcquitter = monte(sujet(dossier({ rdv: null, rdvCertain: false, interlocuteurs: [] })));
    expect(screen.getByText(/Aucun interlocuteur reconnu/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Acquitter' }));
    expect(onAcquitter).toHaveBeenCalledWith(expect.objectContaining({ contactId: null }));
  });

  describe('suite déduite', () => {
    const DEBUT = '2026-12-04T14:00:00.000Z';
    const lignes: NonNullable<DossierRdv['suite']> = [
      { genre: 'diagnostic', nom: 'Diagnostic – Entreprise Fictive', coche: true, existant: null },
      { genre: 'rdv', titre: 'Diagnostic', debut: DEBUT, coche: true, dejaAgenda: null },
      { genre: 'relance', titre: 'Relancer Camille', echeance: '2026-12-18', coche: false },
    ];
    const acquitte = (onAcquitter: ReturnType<typeof vi.fn>) => {
      fireEvent.click(screen.getByRole('button', { name: 'Acquitter' }));
      return onAcquitter.mock.calls[0]?.[0] as Record<string, unknown>;
    };

    it('cochées d’avance : celles dites clairement ; les autres décochées et modifiables', () => {
      monte(sujet(dossier({ suite: lignes })));
      expect(
        screen.getByRole<HTMLInputElement>('checkbox', { name: /Créer le diagnostic/ }).checked,
      ).toBe(true);
      expect(
        screen.getByRole<HTMLInputElement>('checkbox', { name: /Créer le rendez-vous/ }).checked,
      ).toBe(true);
      expect(
        screen.getByRole<HTMLInputElement>('checkbox', { name: /Créer la tâche de relance/ })
          .checked,
      ).toBe(false);
    });

    it('envoie à l’acquittement les lignes cochées, avec les textes corrigés', () => {
      const onAcquitter = monte(sujet(dossier({ suite: lignes })));
      fireEvent.change(screen.getByLabelText('Nom du diagnostic'), {
        target: { value: 'Diagnostic – Nom corrigé' },
      });
      fireEvent.click(screen.getByRole('checkbox', { name: /Créer la tâche de relance/ }));
      const corps = acquitte(onAcquitter);
      expect(corps.suite).toEqual({
        diagnostic: { nom: 'Diagnostic – Nom corrigé' },
        rdv: { titre: 'Diagnostic', debut: DEBUT },
        relance: { titre: 'Relancer Camille', echeance: '2026-12-18' },
      });
    });

    it('une ligne décochée n’est pas envoyée, et sans aucune ligne la clé suite est absente', () => {
      const onAcquitter = monte(sujet(dossier({ suite: lignes })));
      fireEvent.click(screen.getByRole('checkbox', { name: /Créer le diagnostic/ }));
      fireEvent.click(screen.getByRole('checkbox', { name: /Créer le rendez-vous/ }));
      expect(acquitte(onAcquitter)).not.toHaveProperty('suite');
    });

    it('sans suite dans le dossier : rien de plus à l’écran ni dans le corps', () => {
      const onAcquitter = monte(sujet(dossier()));
      expect(screen.queryByRole('checkbox', { name: /Créer/ })).toBeNull();
      expect(acquitte(onAcquitter)).not.toHaveProperty('suite');
    });

    it('rendez-vous déjà dans l’agenda et diagnostic existant : lignes faites, rien à cocher', () => {
      monte(
        sujet(
          dossier({
            suite: [
              {
                genre: 'diagnostic',
                nom: 'Diagnostic – X',
                coche: false,
                existant: { id: 'd-1', nom: 'Diagnostic ancien' },
              },
              {
                genre: 'rdv',
                titre: 'Diagnostic',
                debut: DEBUT,
                coche: false,
                dejaAgenda: { eventId: 'ev-9', titre: 'Diagnostic fictif', debut: DEBUT },
              },
            ],
          }),
        ),
      );
      expect(screen.getByText(/Prochain rendez-vous déjà dans l’agenda/).textContent).toContain(
        'Diagnostic fictif',
      );
      expect(screen.getByText(/Diagnostic déjà créé/).textContent).toContain('Diagnostic ancien');
      expect(
        screen.queryByRole('checkbox', { name: /Créer le (diagnostic|rendez-vous)/ }),
      ).toBeNull();
    });
  });
});
