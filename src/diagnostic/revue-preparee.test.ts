import { describe, expect, it } from 'vitest';
import {
  fusionnerPropositions,
  propositionsRevueSchema,
  type PropositionsRevue,
} from './revue-preparee.js';
import { SupportInvalide } from './support.js';

const propositions = (mot = 'a'): PropositionsRevue => ({
  preconisations: [
    { cle: 'r1', titre: `Titre ${mot}`, texte: `Proposition ${mot}`, bibliotheque: 'lib-1' },
    { cle: 'r2', titre: 'Autre', texte: 'Autre proposition' },
  ],
  planAction: {
    court: {
      dimension: `Dimension ${mot}`,
      blocs: [{ cle: 'b3', bloc: 'Cible', texte: `Action ${mot}` }],
    },
    moyen: { dimension: 'Moyen', blocs: [] },
    long: { dimension: 'Long', blocs: [{ cle: 'b2', bloc: 'Canaux', texte: 'Action longue' }] },
  },
  conclusion: { proposition: `Conclusion ${mot}` },
});

const maintenant = new Date('2026-11-05T10:00:00.000Z');

// Forme de la revue fusionnée, pour lire le résultat sans `any`.
type Revue = {
  statut: string;
  savedAt: string;
  preconisations: Record<string, Record<string, unknown>>;
  planAction: Record<
    string,
    { dimension: unknown; blocs: Record<string, Record<string, unknown>>; libre: unknown }
  >;
  conclusion: Record<string, unknown>;
  scores?: unknown;
  profil?: unknown;
  indicateurs?: unknown;
};
const fusion = (...args: Parameters<typeof fusionnerPropositions>) =>
  fusionnerPropositions(...args) as unknown as Revue;

describe('fusionnerPropositions', () => {
  it('crée une revue en brouillon, sans choix ni texte du pilote', () => {
    const r = fusion(null, propositions(), maintenant);
    expect(r.statut).toBe('brouillon');
    expect(r.savedAt).toBe('2026-11-05T10:00:00.000Z');
    expect(r.preconisations.r1!).toEqual({
      titre: 'Titre a',
      texte: 'Proposition a',
      bibliotheque: 'lib-1',
      choix: '',
      detail: '',
    });
    expect(r.preconisations.r2!.bibliotheque).toBeNull();
    expect(r.planAction.court!.dimension).toBe('Dimension a');
    expect(r.planAction.court!.blocs.b3!).toEqual({
      bloc: 'Cible',
      texte: 'Action a',
      choix: '',
      detail: '',
    });
    expect(r.planAction.court!.libre).toBe('');
    expect(r.conclusion).toMatchObject({ proposition: 'Conclusion a', choix: '', detail: '' });
  });

  it('sur un brouillon : remplace les propositions, garde choix, texte et libre du pilote', () => {
    const existante = {
      statut: 'brouillon',
      scores: { outils: 3 },
      profil: 'Fictif',
      indicateurs: 'Indicateurs du pilote',
      preconisations: {
        r1: {
          titre: 'Ancien',
          texte: 'Ancienne proposition',
          choix: 'remplacer',
          detail: 'Mon texte',
        },
        r9: { titre: 'Ajoutée par le pilote', texte: '', choix: 'garder', detail: 'À moi' },
      },
      planAction: {
        court: {
          dimension: 'Ancienne',
          blocs: {
            b3: { bloc: 'Cible', texte: 'Ancienne', choix: 'garder', detail: 'Mon détail' },
          },
          libre: 'Mon commentaire libre',
        },
      },
      conclusion: {
        proposition: 'Ancienne conclusion',
        choix: 'remplacer',
        detail: 'Ma conclusion',
        libre: 'x',
      },
    };
    const r = fusion(existante, propositions('b'), maintenant);
    expect(r.preconisations.r1!).toMatchObject({
      titre: 'Titre b',
      texte: 'Proposition b',
      choix: 'remplacer',
      detail: 'Mon texte',
    });
    expect(r.preconisations.r9!).toEqual(existante.preconisations.r9);
    expect(r.preconisations.r2!).toMatchObject({ choix: '', detail: '' });
    expect(r.planAction.court!.blocs.b3!).toMatchObject({
      texte: 'Action b',
      choix: 'garder',
      detail: 'Mon détail',
    });
    expect(r.planAction.court!.libre).toBe('Mon commentaire libre');
    expect(r.planAction.court!.dimension).toBe('Dimension b');
    expect(r.conclusion).toMatchObject({
      proposition: 'Conclusion b',
      choix: 'remplacer',
      detail: 'Ma conclusion',
      libre: 'x',
    });
    expect(r.scores).toEqual({ outils: 3 });
    expect(r.profil).toBe('Fictif');
    expect(r.indicateurs).toBe('Indicateurs du pilote');
    expect(r.statut).toBe('brouillon');
  });

  it('une revue sans statut reste utilisable et passe en brouillon', () => {
    const r = fusion({ preconisations: {} }, propositions(), maintenant);
    expect(r.statut).toBe('brouillon');
  });

  it('refuse une revue validée et ne modifie pas l entrée', () => {
    const validee = { statut: 'validée', preconisations: { r1: { texte: 'X', choix: 'garder' } } };
    const copie = structuredClone(validee);
    expect(() => fusionnerPropositions(validee, propositions(), maintenant)).toThrow(
      SupportInvalide,
    );
    expect(validee).toEqual(copie);
  });

  it('ne modifie jamais la revue passée en paramètre', () => {
    const brouillon = {
      statut: 'brouillon',
      preconisations: { r1: { texte: 'X', choix: 'garder' } },
    };
    const copie = structuredClone(brouillon);
    fusionnerPropositions(brouillon, propositions(), maintenant);
    expect(brouillon).toEqual(copie);
  });
});

describe('propositionsRevueSchema', () => {
  const base = propositions();
  const accepte = (p: unknown) => propositionsRevueSchema.safeParse(p).success;

  it('accepte des propositions valides', () => {
    expect(accepte(base)).toBe(true);
  });

  it('refuse un horizon inconnu', () => {
    expect(
      accepte({
        ...base,
        planAction: { ...base.planAction, annuel: { dimension: 'x', blocs: [] } },
      }),
    ).toBe(false);
    const sansLong = Object.fromEntries(
      Object.entries(base.planAction).filter(([nom]) => nom !== 'long'),
    );
    expect(accepte({ ...base, planAction: sansLong })).toBe(false);
  });

  it.each(['R1', 'r 1', 'trop-longue', '', 'abcdefg'])('refuse la clé « %s »', (cle) => {
    expect(accepte({ ...base, preconisations: [{ cle, titre: 't', texte: 'x' }] })).toBe(false);
  });

  it('refuse un texte trop long, 0 ou 13 préconisations, 9 blocs', () => {
    const p = (texte: string) => ({ cle: 'r1', titre: 't', texte });
    expect(accepte({ ...base, preconisations: [p('x'.repeat(4001))] })).toBe(false);
    expect(accepte({ ...base, preconisations: [] })).toBe(false);
    expect(
      accepte({
        ...base,
        preconisations: Array.from({ length: 13 }, (_, i) => ({
          cle: `r${i}`,
          titre: 't',
          texte: 'x',
        })),
      }),
    ).toBe(false);
    const blocs = Array.from({ length: 9 }, (_, i) => ({ cle: `b${i}`, bloc: 'B', texte: 'x' }));
    expect(
      accepte({ ...base, planAction: { ...base.planAction, court: { dimension: 'd', blocs } } }),
    ).toBe(false);
  });
});
