import { describe, expect, it } from 'vitest';
import type { ProjetDiag, TestVma } from '../../api.js';
import { filtrer, grouper, lignesSuivies, paginer, resumerVma } from './grouper.js';

const projet = (extra: Partial<ProjetDiag>): ProjetDiag =>
  ({
    id: 'p',
    nom: 'Projet',
    activite: 'Conseil',
    entrepriseId: null,
    etape: 1,
    ...extra,
  }) as ProjetDiag;

const test = (extra: Partial<TestVma>): TestVma =>
  ({
    id: 't',
    entrepriseId: null,
    entrepriseNom: 'Entreprise Fictive',
    type: 'premier',
    statut: 'utilisee',
    creeLe: '2026-04-01T09:00:00Z',
    recueLe: null,
    resultat: null,
    ...extra,
  }) as TestVma;

const resultat = (vma: number | null) => ({ vma, mesurable: vma !== null }) as TestVma['resultat'];

const entreprises = [
  { id: 'e1', nom: 'Entreprise Fictive A', secteur: 'Conseil' },
  { id: 'e2', nom: 'Entreprise Fictive B', secteur: 'Artisanat' },
];

describe('Diagnostics : regroupement par entreprise', () => {
  it('range un diagnostic et plusieurs tests sous une même entreprise', () => {
    const [ligne] = grouper(
      [entreprises[0]!],
      [projet({ id: 'p1', entrepriseId: 'e1' })],
      [
        test({ id: 't1', entrepriseId: 'e1', creeLe: '2026-04-01T09:00:00Z' }),
        test({ id: 't2', entrepriseId: 'e1', creeLe: '2026-09-01T09:00:00Z' }),
      ],
    );
    expect(ligne?.diag?.id).toBe('p1');
    expect(ligne?.tests.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('garde le diagnostic en cours, pas une année déjà restituée', () => {
    const [ligne] = grouper(
      [entreprises[0]!],
      [
        projet({
          id: 'ancien',
          entrepriseId: 'e1',
          statutDiagnostic: 'Restitué',
          updatedAt: '2026-10-30T10:00:00Z',
        }),
        projet({
          id: 'courant',
          entrepriseId: 'e1',
          statutDiagnostic: null,
          updatedAt: '2026-10-01T10:00:00Z',
        }),
      ],
      [],
    );
    expect(ligne?.diag?.id).toBe('courant');
  });

  it('garde une entreprise sans diagnostic ni test', () => {
    const [ligne] = grouper([entreprises[1]!], [], []);
    expect(ligne).toEqual({ id: 'e2', nom: 'Entreprise Fictive B', diag: null, tests: [] });
  });

  it('met un diagnostic sans entreprise dans sa propre ligne, sans identifiant', () => {
    const lignes = grouper([], [projet({ id: 'p9', nom: 'Projet orphelin' })], []);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.id).toBeNull();
    expect(lignes[0]?.nom).toBe('Projet orphelin');
    expect(lignes[0]?.diag?.id).toBe('p9');
    expect(lignes[0]?.tests).toEqual([]);
  });
});

describe('Diagnostics : recherche et pagination', () => {
  const lignes = [
    { id: 'e1', nom: 'Élodie Fictive', diag: null, tests: [] },
    { id: 'e2', nom: 'Atelier Fictif', diag: null, tests: [] },
  ];

  it('filtre sans tenir compte de la casse ni des accents', () => {
    expect(filtrer(lignes, 'elodie').map((l) => l.id)).toEqual(['e1']);
    expect(filtrer(lignes, 'ATELIER').map((l) => l.id)).toEqual(['e2']);
  });

  it('pagine 5 par page et borne la page demandée', () => {
    const liste = Array.from({ length: 6 }, (_, i) => i + 1);
    expect(paginer(liste, 2, 5)).toEqual({ items: [6], page: 2, pages: 2 });
    expect(paginer(liste, 9, 5)).toEqual({ items: [6], page: 2, pages: 2 });
    expect(paginer(liste, 0, 5)).toEqual({ items: [1, 2, 3, 4, 5], page: 1, pages: 2 });
  });

  it('renvoie une page 1 vide quand rien ne correspond', () => {
    expect(paginer([], 3, 5)).toEqual({ items: [], page: 1, pages: 1 });
  });
});

describe('Diagnostics : résumé des tests VMA', () => {
  it("ignore les essais dans l'évolution et l'écart", () => {
    const r = resumerVma([
      test({ id: 'a', type: 'premier', recueLe: '2026-04-14T10:00:00Z', resultat: resultat(3400) }),
      test({ id: 'b', type: 'premier', recueLe: '2026-10-02T10:00:00Z', resultat: resultat(4150) }),
      test({ id: 'c', type: 'essai', recueLe: '2026-10-15T10:00:00Z', resultat: resultat(2100) }),
    ]);
    expect(r.evolution.map((p) => p.vma)).toEqual([3400, 4150]);
    expect(r.ecart).toEqual({ euros: 750, pourcentage: 22 });
    expect(r.dernier?.type).toBe('essai');
  });

  it('mode portefeuille : le dernier résultat porte l’allure totale, comme le mail', () => {
    const r = resumerVma([
      test({
        id: 'a',
        type: 'essai',
        recueLe: '2026-10-22T10:00:00Z',
        resultat: {
          ...resultat(14000)!,
          modePortefeuille: true,
          recurrent: 80000,
          allureActuelle: 94000,
        },
      }),
    ]);
    expect(r.dernier?.allure).toBe(94000);
    expect(r.dernier?.vma).toBe(14000);
    expect(
      resumerVma([test({ id: 'b', recueLe: '2026-10-22T10:00:00Z', resultat: resultat(14000) })])
        .dernier?.allure,
    ).toBeNull();
  });

  it('sans résultat reçu : pas de dernier résultat ni d’évolution', () => {
    expect(resumerVma([test({ id: 'x', statut: 'envoyee' })])).toEqual({
      dernier: null,
      evolution: [],
      ecart: null,
    });
  });

  it('exclut une VMA non mesurable de l’évolution', () => {
    const r = resumerVma([
      test({ id: 'a', recueLe: '2026-04-14T10:00:00Z', resultat: resultat(null) }),
      test({ id: 'b', recueLe: '2026-10-02T10:00:00Z', resultat: resultat(4150) }),
    ]);
    expect(r.evolution).toEqual([{ date: '2026-10-02T10:00:00Z', vma: 4150 }]);
    expect(r.ecart).toBeNull();
  });
});

describe('Diagnostics : entreprises suivies seulement', () => {
  it('ne garde que les lignes avec un diagnostic ou un test VMA', () => {
    const lignes = grouper(
      [
        { id: 'e1', nom: 'Suivie avec diagnostic', secteur: null },
        { id: 'e2', nom: 'Suivie avec test', secteur: null },
        { id: 'e3', nom: 'Jamais suivie', secteur: null },
      ],
      [projet({ id: 'p1', entrepriseId: 'e1' })],
      [test({ id: 't1', entrepriseId: 'e2' })],
    );
    expect(lignesSuivies(lignes).map((l) => l.id)).toEqual(['e1', 'e2']);
  });
});
