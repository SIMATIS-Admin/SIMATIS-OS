import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import {
  emettreFacture,
  encaisserFacture,
  FactureInvalide,
  FactureIntrouvable,
  lireFacturesEmises,
} from './factures-emission.js';
import { facturesParMandat } from './factures.js';
import { creerBareme, creerTrajet, creerVehicule, trajetSchema, validerBareme } from './ik.js';
import { ecrireDelaiMandat } from './mandats.js';
import {
  archiverRevenu,
  creerRevenu,
  lireRevenu,
  modifierRevenu,
  occurrencesRevenus,
  revenuSchema,
} from './revenus.js';
import { gestionIkTrajets } from './schema.js';

// Données fictives : aucun client, montant ni taux réels.
describe('Émission et encaissement d’une facture de mandat', () => {
  let t: TestApp;
  let inst = '';
  let vehiculeId = '';
  const dans = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, inst, fn);
  const jour = '2026-11-12';

  const preparer = () =>
    dans(async (tx) => {
      const fraisId = (
        await creerRevenu(
          tx,
          inst,
          revenuSchema.parse({
            libelle: 'Frais fictifs',
            type: 'refacturation',
            mandat: 'emi-a',
            montantHtCents: 12_000,
            date: '2026-11-05',
          }),
        )
      ).id;
      const abonnementId = (
        await creerRevenu(
          tx,
          inst,
          revenuSchema.parse({
            libelle: 'Abonnement fictif',
            type: 'abonnement',
            mandat: 'emi-a',
            montantHtCents: 30_000,
            date: '2026-11-03',
            recurrence: 'mensuelle',
          }),
        )
      ).id;
      const trajet = await creerTrajet(
        tx,
        inst,
        trajetSchema.parse({
          vehiculeId,
          date: '2026-11-04',
          trajet: `Trajet ${Math.random().toString(36).slice(2, 7)}`,
          commentaire: 'Réunion fictive',
          kmAllerRetour: 40,
          mandat: 'emi-a',
          refacturer: true,
        }),
      );
      return { fraisId, abonnementId, trajetId: trajet.id };
    });

  beforeAll(async () => {
    t = await setupTestApp();
    inst = (
      await createInstance(t.owner.db, {
        slug: 'emi-propre',
        nom: 'Mon activité',
        type: 'propre',
        config: { modules: ['gestion'] },
      })
    ).id;
    await dans(async (tx) => {
      vehiculeId = (await creerVehicule(tx, inst, { libelle: 'Voiture', categorie: 'auto' })).id;
      const b = await creerBareme(tx, inst, {
        annee: 2026,
        categorie: 'auto',
        source: 'Barème fictif de test',
        tranches: [{ deKm: 0, jusquaKm: null, tauxDixMilliemes: 5000, forfaitCents: 0 }],
      });
      await validerBareme(tx, b.id, '2026-11-03');
      await ecrireDelaiMandat(tx, inst, 'emi-a', 45);
    });
  });
  afterAll(async () => {
    await t.drop();
  });

  const emettre = (numero: string, exclure: string[] = [], dateEmission = jour) =>
    dans((tx) => emettreFacture(tx, inst, { mandat: 'emi-a', numero, dateEmission, exclure }));

  it('émet la facture d’un mandat et fige ses lignes', async () => {
    const ids = await preparer();
    const f = await emettre('F-001');
    expect(f).toMatchObject({
      mandat: 'emi-a',
      numero: 'F-001',
      dateEmission: jour,
      delaiJours: 45,
      etat: 'emise',
      // 120 € de frais + 300 € d'abonnement + 40 km × 0,50 € d'IK.
      totalHtCents: 12_000 + 30_000 + 2_000,
    });
    expect(f.lignes.map((l) => l.sorte).sort()).toEqual(['frais', 'ik', 'recurrent']);
    await dans(async (tx) => {
      const frais = await lireRevenu(tx, ids.fraisId);
      expect(frais).toMatchObject({ etat: 'emise', referenceFacture: 'F-001' });
      const ech = (await occurrencesRevenus(tx, '2026-11-01', '2026-11-30')).find(
        (o) => o.revenuId === ids.abonnementId,
      );
      expect(ech).toMatchObject({ etat: 'emise', referenceFacture: 'F-001' });
      const [tr] = await tx
        .select()
        .from(gestionIkTrajets)
        .where(eq(gestionIkTrajets.id, ids.trajetId));
      expect(tr!.factureId).toBe(f.id);
    });
  });

  it('une seconde émission ne reprend rien', async () => {
    const avant = (await dans((tx) => lireFacturesEmises(tx))).length;
    await expect(emettre('F-002')).rejects.toBeInstanceOf(FactureInvalide);
    expect((await dans((tx) => lireFacturesEmises(tx))).length).toBe(avant);
  });

  it('les lignes d’une facture émise sont figées', async () => {
    const [f] = await dans((tx) => lireFacturesEmises(tx));
    const frais = f!.lignes.find((l) => l.sorte === 'frais')!;
    const id = frais.cle.replace('revenu:', '').split('|')[0]!;
    await dans((tx) => modifierRevenu(tx, id, { montantHtCents: 1 }));
    const [apres] = await dans((tx) => lireFacturesEmises(tx));
    expect(apres!.lignes.find((l) => l.sorte === 'frais')!.montantHtCents).toBe(12_000);
  });

  it('refuse un numéro vide ou déjà utilisé, sans rien modifier', async () => {
    const { fraisId } = await preparer();
    await expect(emettre('   ')).rejects.toBeInstanceOf(FactureInvalide);
    await expect(emettre('F-001')).rejects.toBeInstanceOf(FactureInvalide);
    expect((await dans((tx) => lireRevenu(tx, fraisId))).etat).toBe('prevue');
  });

  it('une ligne exclue reste à émettre', async () => {
    const aEmettre = await dans((tx) => facturesParMandat(tx, jour, jour));
    const frais = aEmettre.factures[0]!.lignes.find((l) => l.sorte === 'frais')!;
    const f = await emettre('F-003', [frais.cle]);
    expect(f.lignes.some((l) => l.sorte === 'frais')).toBe(false);
    const reste = await dans((tx) => facturesParMandat(tx, jour, jour));
    expect(reste.factures[0]!.lignes.map((l) => l.cle)).toContain(frais.cle);
  });

  it('un trajet sans barème n’est ni facturé ni marqué facturé', async () => {
    await dans(async (tx) => {
      const v2 = await creerVehicule(tx, inst, { libelle: 'Autre', categorie: 'moto' });
      await creerTrajet(
        tx,
        inst,
        trajetSchema.parse({
          vehiculeId: v2.id,
          date: '2026-11-06',
          trajet: 'Sans barème',
          commentaire: 'Réunion fictive',
          kmAllerRetour: 10,
          mandat: 'emi-a',
          refacturer: true,
        }),
      );
    });
    const f = await emettre('F-004');
    expect(f.lignes.some((l) => l.libelle.includes('Sans barème'))).toBe(false);
    const [tr] = await dans((tx) =>
      tx.select().from(gestionIkTrajets).where(eq(gestionIkTrajets.trajet, 'Sans barème')),
    );
    expect(tr!.factureId).toBeNull();
  });

  it('refuse un mandat sans rien à facturer', async () => {
    await expect(
      dans((tx) =>
        emettreFacture(tx, inst, {
          mandat: 'mandat-vide',
          numero: 'F-VIDE',
          dateEmission: jour,
          exclure: [],
        }),
      ),
    ).rejects.toBeInstanceOf(FactureInvalide);
  });

  it('liste les factures, la plus récente d’abord', async () => {
    const l = await dans((tx) => lireFacturesEmises(tx));
    expect(l.map((f) => f.numero)[0]).toBe('F-004');
  });

  it('inclut toutes les lignes du mois de l’émission, pas seulement celles d’avant la date choisie', async () => {
    await dans(async (tx) => {
      await creerRevenu(
        tx,
        inst,
        revenuSchema.parse({
          libelle: 'Échéance du 25',
          type: 'refacturation',
          mandat: 'emi-b',
          montantHtCents: 7_000,
          date: '2026-11-25',
        }),
      );
    });
    const f = await dans((tx) =>
      emettreFacture(tx, inst, {
        mandat: 'emi-b',
        numero: 'F-MOIS',
        dateEmission: '2026-11-05',
        exclure: [],
      }),
    );
    expect(f.totalHtCents).toBe(7_000);
  });

  describe('encaissement', () => {
    it('encaisse même si une recette de la facture a été archivée depuis', async () => {
      const ids = await preparer();
      const f = await emettre('F-ARCH');
      await dans((tx) => archiverRevenu(tx, ids.fraisId));
      const e = await dans((tx) => encaisserFacture(tx, inst, f.id, '2026-12-22'));
      expect(e.etat).toBe('encaissee');
    });

    it('passe la facture et ses recettes à encaissée', async () => {
      const ids = await preparer();
      const f = await emettre('F-005');
      const e = await dans((tx) => encaisserFacture(tx, inst, f.id, '2026-12-20'));
      expect(e).toMatchObject({ etat: 'encaissee', dateEncaissement: '2026-12-20' });
      await dans(async (tx) => {
        expect(await lireRevenu(tx, ids.fraisId)).toMatchObject({
          etat: 'encaissee',
          dateEncaissement: '2026-12-20',
        });
        const ech = (await occurrencesRevenus(tx, '2026-11-01', '2026-11-30')).find(
          (o) => o.revenuId === ids.abonnementId,
        );
        expect(ech).toMatchObject({ etat: 'encaissee', dateEncaissement: '2026-12-20' });
      });
    });

    it('refuse d’encaisser deux fois, une date antérieure à l’émission, ou une facture inconnue', async () => {
      const [f] = await dans((tx) => lireFacturesEmises(tx));
      const encaissee = (await dans((tx) => lireFacturesEmises(tx))).find(
        (x) => x.etat === 'encaissee',
      )!;
      await expect(
        dans((tx) => encaisserFacture(tx, inst, encaissee.id, '2026-12-25')),
      ).rejects.toBeInstanceOf(FactureInvalide);
      await preparer();
      const nouvelle = await emettre('F-006');
      await expect(
        dans((tx) => encaisserFacture(tx, inst, nouvelle.id, '2026-11-01')),
      ).rejects.toBeInstanceOf(FactureInvalide);
      await expect(
        dans((tx) =>
          encaisserFacture(tx, inst, '00000000-0000-4000-8000-000000000000', '2026-12-25'),
        ),
      ).rejects.toBeInstanceOf(FactureIntrouvable);
      expect(f).toBeTruthy();
    });
  });
});
