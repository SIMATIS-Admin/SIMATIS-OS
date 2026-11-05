import { describe, expect, it } from 'vitest';
import { affairesPipe, mouvementsPipe, type OppPipe } from './pipe.js';

const opp = (o: Partial<OppPipe> = {}): OppPipe => ({
  id: 'a1',
  titre: 'Affaire fictive',
  entreprise: 'Société Exemple',
  etape: 'proposition',
  clos: null,
  montant: 10_000,
  modeFacturation: 'spot',
  dureeEngagementMois: 12,
  probabiliteManuelle: null,
  signatureEstimee: '2027-01-15',
  echeance: null,
  ...o,
});
const proba = new Map<string, number | null>([
  ['proposition', 60],
  ['detection', null],
]);
const base = {
  delaiJours: 30,
  decalageMois: 0,
  exclus: new Set<string>(),
  aujourdhui: '2026-11-12',
  fin: '2027-12-31',
};

describe('affairesPipe', () => {
  it('calcule le total en centimes, la probabilité effective et le repli sur la clôture HubSpot', () => {
    const [a, b] = affairesPipe(
      [
        opp(),
        opp({ id: 'b', signatureEstimee: null, echeance: '2027-03-01', probabiliteManuelle: 20 }),
      ],
      proba,
    );
    expect(a).toMatchObject({
      totalCents: 1_000_000,
      probabilite: 60,
      signature: '2027-01-15',
      statut: 'comptee',
    });
    expect(b).toMatchObject({ probabilite: 20, signature: '2027-03-01', statut: 'comptee' });
  });

  it('un abonnement vaut mensualité × durée, avec sa mensualité', () => {
    const [a] = affairesPipe(
      [opp({ modeFacturation: 'recurrent', montant: 2_500, dureeEngagementMois: 12 })],
      proba,
    );
    expect(a).toMatchObject({ recurrent: true, mensuelCents: 250_000, totalCents: 3_000_000 });
  });

  it('range les affaires inexploitables avec leur raison, sans rien supposer', () => {
    const r = affairesPipe(
      [
        opp({ id: 'm', montant: null }),
        opp({ id: 'p', etape: 'detection' }),
        opp({ id: 'd', signatureEstimee: null }),
        opp({ id: 'c', clos: 'gagne' }),
      ],
      proba,
    );
    expect(r.map((x) => [x.id, x.statut])).toEqual([
      ['m', 'sans_montant'],
      ['p', 'sans_probabilite'],
      ['d', 'sans_date'],
    ]);
  });

  it('compte à zéro une affaire à 0 %, sans la masquer', () => {
    const [a] = affairesPipe([opp({ probabiliteManuelle: 0 })], proba);
    expect(a).toMatchObject({ probabilite: 0, statut: 'comptee' });
  });
});

describe('mouvementsPipe', () => {
  const a = () => affairesPipe([opp()], proba);

  it('central : ponctuel pondéré, 50 % à signature + délai, 50 % 60 jours plus tard', () => {
    const m = mouvementsPipe(a(), { ...base, scenario: 'central' });
    expect(m.map((x) => [x.date, x.montantCents, x.sens, x.nature, x.ref])).toEqual([
      ['2027-02-14', 300_000, 'entree', 'recette', 'pipe:a1'],
      ['2027-04-15', 300_000, 'entree', 'recette', 'pipe:a1'],
    ]);
    expect(m[0]!.estime).toBe(true);
    expect(m[0]!.note).toContain('60 %');
  });

  it('central : abonnement pondéré, une échéance par mois, dans l’horizon seulement', () => {
    const r = affairesPipe(
      [
        opp({
          id: 'b',
          modeFacturation: 'recurrent',
          montant: 2_500,
          probabiliteManuelle: 70,
          signatureEstimee: '2026-12-10',
        }),
      ],
      proba,
    );
    const m = mouvementsPipe(r, { ...base, scenario: 'central', fin: '2027-04-30' });
    expect(m.map((x) => [x.date, x.montantCents])).toEqual([
      ['2027-01-09', 175_000],
      ['2027-02-09', 175_000],
      ['2027-03-09', 175_000],
      ['2027-04-09', 175_000],
    ]);
    expect(mouvementsPipe(r, { ...base, scenario: 'central' })).toHaveLength(12);
  });

  it('sécurisé : aucune affaire', () => {
    expect(mouvementsPipe(a(), { ...base, scenario: 'securise' })).toEqual([]);
  });

  it('ambitieux : les affaires à 50 % et plus à 100 %, rien en dessous', () => {
    const r = affairesPipe([opp(), opp({ id: 'f', probabiliteManuelle: 30 })], proba);
    const m = mouvementsPipe(r, { ...base, scenario: 'ambitieux' });
    expect(m.map((x) => [x.ref, x.montantCents])).toEqual([
      ['pipe:a1', 500_000],
      ['pipe:a1', 500_000],
    ]);
  });

  it('le décalage repousse les dates et peut sortir de l’horizon sans erreur', () => {
    const m = mouvementsPipe(a(), { ...base, scenario: 'central', decalageMois: 3 });
    expect(m.map((x) => x.date)).toEqual(['2027-05-15', '2027-07-14']);
    expect(
      mouvementsPipe(a(), { ...base, scenario: 'central', decalageMois: 6, fin: '2027-06-30' }),
    ).toEqual([]);
  });

  it('une affaire exclue ne compte pas', () => {
    expect(mouvementsPipe(a(), { ...base, scenario: 'central', exclus: new Set(['a1']) })).toEqual(
      [],
    );
  });

  it('une signature dépassée est comptée à la date du jour, avec sa note', () => {
    const r = affairesPipe([opp({ signatureEstimee: '2026-10-01' })], proba);
    const [m] = mouvementsPipe(r, { ...base, delaiJours: 0, scenario: 'central' });
    expect(m).toMatchObject({ date: '2026-11-12' });
    expect(m!.note).toContain('dépassée');
  });

  it('sans délai de paiement défini, suppose zéro jour', () => {
    const [m] = mouvementsPipe(a(), { ...base, delaiJours: null, scenario: 'central' });
    expect(m!.date).toBe('2027-01-15');
  });

  it('une affaire à 0 % ne produit aucun mouvement', () => {
    const r = affairesPipe([opp({ probabiliteManuelle: 0 })], proba);
    expect(mouvementsPipe(r, { ...base, scenario: 'central' })).toEqual([]);
  });

  it('une signature passée ne fait pas empiler l’arriéré : l’échéancier démarre aujourd’hui', () => {
    const r = affairesPipe(
      [
        opp({
          id: 'r',
          modeFacturation: 'recurrent',
          montant: 2_000,
          probabiliteManuelle: 100,
          signatureEstimee: '2026-05-01',
        }),
      ],
      proba,
    );
    const m = mouvementsPipe(r, { ...base, scenario: 'central' });
    expect(m).toHaveLength(12);
    expect(m.slice(0, 3).map((x) => [x.date, x.montantCents])).toEqual([
      ['2026-12-12', 200_000],
      ['2027-01-12', 200_000],
      ['2027-02-12', 200_000],
    ]);
    expect(m[0]!.note).toContain('dépassée');
  });

  it('mode total : toutes les affaires retenues à 100 %, même sous 50 %, dans les deux scénarios', () => {
    const r = affairesPipe([opp({ probabiliteManuelle: 30 })], proba);
    for (const scenario of ['central', 'ambitieux'] as const) {
      const m = mouvementsPipe(r, { ...base, scenario, mode: 'total' });
      expect(m.map((x) => x.montantCents)).toEqual([500_000, 500_000]);
      expect(m[0]!.note).toContain('100 %');
    }
  });

  it('mode pondéré : l’ambitieux pondère aussi, sans seuil à 50 %', () => {
    const r = affairesPipe([opp({ probabiliteManuelle: 30 })], proba);
    const m = mouvementsPipe(r, { ...base, scenario: 'ambitieux', mode: 'pondere' });
    expect(m.map((x) => x.montantCents)).toEqual([150_000, 150_000]);
  });

  it('inclure à faux retire tout le pipe, quel que soit le mode', () => {
    for (const mode of ['pondere', 'total'] as const)
      expect(mouvementsPipe(a(), { ...base, scenario: 'central', mode, inclure: false })).toEqual(
        [],
      );
  });

  it('une hypothèse remplace montant et probabilité, et le signale', () => {
    const [x] = affairesPipe(
      [opp()],
      proba,
      new Map([['a1', { montant: 20_000, probabilite: 25 }]]),
    );
    expect(x).toMatchObject({ totalCents: 2_000_000, probabilite: 25, surcharge: true });
    const [sans] = affairesPipe([opp()], proba);
    expect(sans!.surcharge).toBe(false);
    const m = mouvementsPipe([x!], { ...base, scenario: 'central' });
    expect(m.map((e) => e.montantCents)).toEqual([250_000, 250_000]);
  });

  it('une hypothèse de montant fait entrer une affaire sans montant ; 0 % est une vraie valeur', () => {
    const [x] = affairesPipe(
      [opp({ montant: null })],
      proba,
      new Map([['a1', { montant: 4_000 }]]),
    );
    expect(x).toMatchObject({ statut: 'comptee', totalCents: 400_000, surcharge: true });
    const [z] = affairesPipe([opp()], proba, new Map([['a1', { probabilite: 0 }]]));
    expect(z).toMatchObject({ probabilite: 0, surcharge: true });
  });

  it('l’hypothèse de montant d’un abonnement est la mensualité', () => {
    const [x] = affairesPipe(
      [opp({ modeFacturation: 'recurrent', montant: 1_000 })],
      proba,
      new Map([['a1', { montant: 3_000 }]]),
    );
    expect(x).toMatchObject({ mensuelCents: 300_000, totalCents: 3_600_000 });
  });
});
