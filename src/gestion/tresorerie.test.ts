import { describe, expect, it } from 'vitest';
import type { OccurrenceRevenu } from './revenus.js';
import type { OccurrenceVue } from './service.js';
import {
  agreger,
  calculerBfr,
  debutPeriode,
  mouvementsDepenses,
  mouvementsFacturesIk,
  mouvementsRecettes,
} from './tresorerie.js';
import type { FactureEmise } from './factures-emission.js';
import type { IkRefacturable } from './ik.js';

const dep = (
  o: Partial<OccurrenceVue> & { date: string; montantTtcCents: number },
): OccurrenceVue => ({
  depenseId: 'd1',
  cle: `d1|${o.date}`,
  libelle: 'Dépense fictive',
  categorie: null,
  etat: 'a_venir',
  statut: 'prevue',
  recurrente: false,
  payeur: 'societe',
  tvaCents: null,
  affectations: [],
  refacturable: false,
  justificatif: null,
  ...o,
});
const rec = (
  o: Partial<OccurrenceRevenu> & { date: string; montantHtCents: number },
): OccurrenceRevenu => ({
  revenuId: 'r1',
  cle: `r1|${o.date}`,
  libelle: 'Recette fictive',
  type: 'commission',
  mandat: null,
  certitude: 'certaine',
  dateEncaissement: null,
  etat: 'prevue',
  referenceFacture: null,
  recurrente: false,
  depenseId: null,
  tvaCents: null,
  ...o,
});
const base = { scenario: 'central' as const, soldeDate: '2026-10-31', aujourdhui: '2026-11-02' };

describe('mouvementsDepenses', () => {
  it('ne fait pas sortir du compte une dépense avancée ou créditée à l’associé (loyer)', () => {
    const r = mouvementsDepenses(
      [dep({ date: '2026-12-01', montantTtcCents: 40_000, payeur: 'associe' })],
      '2026-10-31',
      '2026-11-02',
    );
    expect(r.mouvements).toHaveLength(0);
  });

  it('compte une échéance dépassée à la date du jour, et ignore celles d’avant le solde', () => {
    const r = mouvementsDepenses(
      [
        dep({ date: '2026-11-01', montantTtcCents: 10_000 }),
        dep({ date: '2026-10-15', montantTtcCents: 5_000 }),
      ],
      '2026-10-31',
      '2026-11-02',
    );
    expect(r.mouvements.map((m) => [m.date, m.montantCents])).toEqual([['2026-11-02', 10_000]]);
    expect(r.ignorees).toBe(1);
  });

  it('ne compte une dépense payée que si elle est postérieure au solde (pas de double compte)', () => {
    const payee = (date: string) => dep({ date, montantTtcCents: 7_000, etat: 'payee' });
    expect(
      mouvementsDepenses([payee('2026-10-20')], '2026-10-31', '2026-11-02').mouvements,
    ).toEqual([]);
    expect(
      mouvementsDepenses([payee('2026-11-01')], '2026-10-31', '2026-11-02').mouvements,
    ).toHaveLength(1);
  });
});

describe('mouvementsRecettes', () => {
  const p = { ...base, delaiJours: 30, retardJours: 0 };

  it('encaisse à la date de facture plus le délai réglé, jamais en HT silencieux', () => {
    const r = mouvementsRecettes([rec({ date: '2026-11-10', montantHtCents: 100_000 })], p);
    expect(r.mouvements[0]).toMatchObject({
      date: '2026-12-10',
      montantCents: 100_000,
      estime: true,
    });
    expect(r.mouvements[0]!.note).toContain('HT');
  });

  it('ajoute la TVA renseignée et décale la date avec un retard simulé', () => {
    const o = rec({ date: '2026-11-10', montantHtCents: 100_000, tvaCents: 20_000 });
    const r = mouvementsRecettes([o], { ...p, retardJours: 30 });
    expect(r.mouvements[0]).toMatchObject({ date: '2027-01-09', montantCents: 120_000 });
    expect(r.mouvements[0]!.note).toContain('Retard simulé de 30 jours');
  });

  it('sans délai défini, suppose la date de facture et le dit', () => {
    const r = mouvementsRecettes([rec({ date: '2026-11-10', montantHtCents: 1_000 })], {
      ...base,
      delaiJours: null,
      retardJours: 0,
    });
    expect(r.mouvements[0]!.date).toBe('2026-11-10');
    expect(r.mouvements[0]!.note).toContain('Délai de paiement non défini');
  });

  it('sépare les scénarios par certitude : le sécurisé ne retient que le certain', () => {
    const occ = [
      rec({ date: '2026-12-01', montantHtCents: 1_000 }),
      rec({ date: '2026-12-02', montantHtCents: 2_000, certitude: 'probable', cle: 'r2|x' }),
      rec({ date: '2026-12-03', montantHtCents: 4_000, certitude: 'hypothese', cle: 'r3|x' }),
    ];
    const total = (s: 'securise' | 'central' | 'ambitieux') =>
      mouvementsRecettes(occ, { ...p, scenario: s }).mouvements.reduce(
        (t, m) => t + m.montantCents,
        0,
      );
    expect([total('securise'), total('central'), total('ambitieux')]).toEqual([
      1_000, 3_000, 7_000,
    ]);
  });

  it('ne reprend pas une recette encaissée avant le solde, et compte celle d’après à sa date réelle', () => {
    const e = (d: string) =>
      rec({ date: '2026-10-01', montantHtCents: 5_000, etat: 'encaissee', dateEncaissement: d });
    expect(mouvementsRecettes([e('2026-10-20')], p).mouvements).toEqual([]);
    expect(mouvementsRecettes([e('2026-11-01')], p).mouvements[0]!.date).toBe('2026-11-01');
  });
});

describe('agreger', () => {
  it('cumule les périodes à partir du solde, sans afficher de solde s’il manque', () => {
    const m = [
      { date: '2026-11-05', sens: 'entree', montantCents: 100_000 },
      { date: '2026-12-05', sens: 'sortie', montantCents: 30_000 },
    ].map((x) => ({
      ...x,
      libelle: 'x',
      nature: 'recette',
      ref: 'r',
      estime: false,
      note: null,
    })) as Parameters<typeof agreger>[0];
    const avec = agreger(m, {
      solde: 50_000,
      soldeDate: '2026-10-31',
      debut: '2026-11-02',
      fin: '2026-12-31',
      g: 'mois',
    });
    expect(avec.map((x) => x.soldeFinCents)).toEqual([150_000, 120_000]);
    const sans = agreger(m, {
      solde: null,
      soldeDate: null,
      debut: '2026-11-02',
      fin: '2026-12-31',
      g: 'mois',
    });
    expect(sans.map((x) => x.soldeFinCents)).toEqual([null, null]);
    expect(sans.map((x) => x.variationCumuleeCents)).toEqual([100_000, 70_000]);
  });

  it('découpe par semaine commençant le lundi', () => {
    expect(debutPeriode('2026-11-02', 'semaine')).toBe('2026-11-02');
    expect(debutPeriode('2026-11-08', 'semaine')).toBe('2026-11-02');
    expect(debutPeriode('2026-11-18', 'mois')).toBe('2026-11-01');
  });
});

describe('calculerBfr', () => {
  it('= créances facturées − dettes échues, seuil à zéro si négatif, limites dites', () => {
    const recettes = [
      rec({ date: '2026-10-10', montantHtCents: 100_000, etat: 'emise' }),
      rec({ date: '2026-10-11', montantHtCents: 50_000, etat: 'prevue', cle: 'r2|x' }),
    ];
    const depenses = [
      dep({ date: '2026-10-20', montantTtcCents: 30_000 }),
      dep({ date: '2026-12-20', montantTtcCents: 99_000, cle: 'd2|x' }),
    ];
    const b = calculerBfr(recettes, depenses, '2026-11-02', '2026-10-01');
    expect(b).toMatchObject({
      creancesCents: 100_000,
      dettesCents: 30_000,
      bfrCents: 70_000,
      seuilCents: 70_000,
    });
    expect(b.limites.join(' ')).toContain('TVA');
    const neg = calculerBfr([], depenses, '2026-11-02', '2026-10-01');
    expect(neg).toMatchObject({ bfrCents: -30_000, seuilCents: 0 });
  });
});

describe('mouvementsRecettes — recettes d’un mandat', () => {
  const p = { ...base, delaiJours: 30, retardJours: 0 };
  const delaisMandat = new Map<string, number | null>([['m1', 45]]);

  it('date une recette prévue d’un mandat à la fin du mois + le délai du mandat', () => {
    const r = mouvementsRecettes(
      [rec({ date: '2026-11-10', montantHtCents: 100_000, mandat: 'm1' })],
      { ...p, delaisMandat },
    );
    expect(r.mouvements[0]!.date).toBe('2027-01-14');
  });

  it('un mandat sans délai propre retombe sur le délai général', () => {
    const r = mouvementsRecettes(
      [rec({ date: '2026-11-10', montantHtCents: 100_000, mandat: 'm2' })],
      { ...p, delaisMandat },
    );
    expect(r.mouvements[0]!.date).toBe('2026-12-30');
  });

  it('une recette de mandat dont le jour est passé est facturée à la fin du mois courant', () => {
    const r = mouvementsRecettes(
      [rec({ date: '2026-11-01', montantHtCents: 100_000, mandat: 'm1' })],
      { ...p, delaisMandat },
    );
    expect(r.mouvements[0]!.date).toBe('2027-01-14');
  });

  it('sans mandat, la date reste celle de la recette + le délai général', () => {
    const r = mouvementsRecettes([rec({ date: '2026-11-10', montantHtCents: 100_000 })], {
      ...p,
      delaisMandat,
    });
    expect(r.mouvements[0]!.date).toBe('2026-12-10');
  });

  it('une recette émise suit la date d’émission de sa facture et son délai figé', () => {
    const o = rec({ date: '2026-11-10', montantHtCents: 100_000, mandat: 'm1', etat: 'emise' });
    const factures = new Map([[o.cle, { dateEmission: '2026-11-12', delaiJours: 20 }]]);
    const r = mouvementsRecettes([o], { ...p, delaisMandat, factures });
    expect(r.mouvements[0]!.date).toBe('2026-12-02');
  });
});

describe('mouvementsFacturesIk', () => {
  const e = {
    ...base,
    delaiJours: 30 as number | null,
    retardJours: 0,
    delaisMandat: new Map<string, number | null>([['m1', 45]]),
  };
  const ik = (o: Partial<IkRefacturable> = {}): IkRefacturable => ({
    trajetId: 't1',
    mandat: 'm1',
    date: '2026-11-04',
    libelle: 'Trajet fictif',
    indemniteCents: 4_000,
    ...o,
  });
  const facture = (o: Partial<FactureEmise> = {}): FactureEmise => ({
    id: 'f1',
    mandat: 'm1',
    numero: 'F-1',
    dateEmission: '2026-11-12',
    delaiJours: 20,
    totalHtCents: 4_000,
    etat: 'emise',
    dateEncaissement: null,
    lignes: [
      {
        cle: 'ik:t9',
        sorte: 'ik',
        libelle: 'Trajet facturé',
        date: '2026-11-04',
        montantHtCents: 4_000,
        tvaCents: null,
      },
    ],
    ...o,
  });

  it('un trajet à venir entre à la fin du mois + le délai du mandat', () => {
    const m = mouvementsFacturesIk({ ...e, ik: [ik()], factures: [] });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ date: '2027-01-14', montantCents: 4_000, sens: 'entree' });
  });

  it('un trajet sans montant ne produit rien', () => {
    expect(
      mouvementsFacturesIk({ ...e, ik: [ik({ indemniteCents: null })], factures: [] }),
    ).toEqual([]);
  });

  it('la ligne IK d’une facture émise entre à l’émission + le délai figé', () => {
    const m = mouvementsFacturesIk({ ...e, ik: [], factures: [facture()] });
    expect(m[0]).toMatchObject({ date: '2026-12-02', montantCents: 4_000 });
  });

  it('une facture encaissée après la date du solde compte à son encaissement, avant elle jamais', () => {
    const apres = facture({ etat: 'encaissee', dateEncaissement: '2026-11-20' });
    expect(mouvementsFacturesIk({ ...e, ik: [], factures: [apres] })[0]).toMatchObject({
      date: '2026-11-20',
    });
    const avant = facture({ etat: 'encaissee', dateEncaissement: '2026-10-20' });
    expect(mouvementsFacturesIk({ ...e, ik: [], factures: [avant] })).toEqual([]);
  });
});
