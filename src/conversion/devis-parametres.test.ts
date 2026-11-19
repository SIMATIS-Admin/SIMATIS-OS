import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { getInstanceBySlug } from '../instances/service.js';
import type { Instance } from '../instances/schema.js';
import { creerDepuisAffaire, lireDevis } from './devis.js';
import {
  creerClause,
  creerModele,
  enregistrerReglages,
  formatNumeroValide,
  formaterNumero,
  lireParametres,
  supprimerClause,
} from './devis-parametres.js';

describe('formaterNumero', () => {
  it('remplace l’année et le compteur, avec le nombre de chiffres demandé', () => {
    expect(formaterNumero('DEV-{AAAA}-{NNN}', 2026, 7)).toBe('DEV-2026-007');
    expect(formaterNumero('{AAAA}/{NNNN}', 2027, 12)).toBe('2027/0012');
    expect(formaterNumero('D{N}', 2026, 1234)).toBe('D1234');
  });

  it('exige un compteur et refuse les caractères hors texte simple', () => {
    expect(formatNumeroValide('DEV-{AAAA}-{NNN}')).toBe(true);
    expect(formatNumeroValide('DEV-{AAAA}')).toBe(false);
    expect(formatNumeroValide('')).toBe(false);
    expect(formatNumeroValide('DEV <{NNN}>')).toBe(false);
    expect(formatNumeroValide('A'.repeat(41) + '{NNN}')).toBe(false);
  });
});

describe('Paramètres du devis', () => {
  let t: TestApp;
  let simatis: Instance;
  let helioval: Instance;
  let affaires: string[];

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    simatis = (await getInstanceBySlug(t.app.db, 'simatis'))!;
    helioval = (await getInstanceBySlug(t.app.db, 'helioval'))!;
    const { rows } = await t.owner.pool.query<{ id: string }>(
      "select id from opportunites where instance_id = $1 and clos is null and etape in ('qualification', 'proposition', 'negociation') order by titre limit 3",
      [simatis.id],
    );
    affaires = rows.map((r) => r.id);
  });
  afterAll(async () => {
    await t.drop();
  });

  it('renvoie des réglages par défaut tant que rien n’est enregistré', async () => {
    const p = await lireParametres(t.app.db, simatis);
    expect(p.reglages).toMatchObject({
      numerotation: 'DEV-{AAAA}-{NNN}',
      tvaPct: 20,
      validiteJours: 30,
      acomptePct: 0,
    });
    expect(p.clauses).toEqual([]);
    expect(p.modeles).toEqual([]);
  });

  it('refuse un format de numérotation sans compteur', async () => {
    await expect(
      enregistrerReglages(t.app.db, simatis, {
        numerotation: 'DEV-{AAAA}',
        mentions: '',
        tvaPct: 20,
        validiteJours: 30,
        acomptePct: 0,
      }),
    ).rejects.toThrow(/numérotation/);
  });

  it('crée un devis avec le format, les clauses par défaut, le modèle et les réglages', async () => {
    await enregistrerReglages(t.app.db, simatis, {
      numerotation: 'F{AAAA}-{NNNN}',
      mentions: 'Société fictive, adresse fictive',
      tvaPct: 10,
      validiteJours: 45,
      acomptePct: 30,
    });
    await creerClause(t.app.db, simatis, {
      titre: 'Paiement',
      texte: 'À 30 jours.',
      parDefaut: true,
      ordre: 1,
    });
    await creerClause(t.app.db, simatis, {
      titre: 'Option',
      texte: 'Texte facultatif.',
      parDefaut: false,
      ordre: 2,
    });
    const modele = await creerModele(t.app.db, simatis, {
      nom: 'Modèle fictif',
      contexte: 'Contexte du modèle',
      objectifs: 'Objectif 1',
      inclus: 'Prestation A\nPrestation B',
      exclu: 'Hors périmètre',
      livrables: 'Un rapport',
      duree: '6 semaines',
      lignes: [{ libelle: 'Phase 1', unite: 'jour', quantite: 3 }],
    });
    const { devis } = await creerDepuisAffaire(t.app.db, simatis, affaires[0]!, modele.id);
    expect(devis.numero).toBe(`F${new Date().getFullYear()}-0001`);
    expect(devis.clauses).toEqual([{ titre: 'Paiement', texte: 'À 30 jours.', active: true }]);
    expect(devis).toMatchObject({
      contexte: 'Contexte du modèle',
      inclus: 'Prestation A\nPrestation B',
      duree: '6 semaines',
      validiteJours: 45,
      acomptePct: 30,
    });
    expect(devis.lignes).toEqual([
      expect.objectContaining({
        libelle: 'Phase 1',
        unite: 'jour',
        quantite: 3,
        prixUnitaire: null,
      }),
    ]);
    const lu = await lireDevis(t.app.db, simatis, devis.id);
    expect(lu).toMatchObject({ tvaPct: 10, mentions: 'Société fictive, adresse fictive' });
  });

  it('applique la TVA réglée aux totaux', async () => {
    const { devis } = await creerDepuisAffaire(t.app.db, simatis, affaires[1]!);
    await t.owner.pool.query('update devis set lignes = $2::jsonb where id = $1', [
      devis.id,
      JSON.stringify([{ libelle: 'X', unite: 'forfait', quantite: 1, prixUnitaire: 1000 }]),
    ]);
    const lu = await lireDevis(t.app.db, simatis, devis.id);
    expect(lu.totaux).toMatchObject({ ht: 1000, tva: 100, ttc: 1100 });
  });

  it('supprimer une clause de la bibliothèque laisse les devis intacts', async () => {
    const { clauses } = await lireParametres(t.app.db, simatis);
    await supprimerClause(t.app.db, simatis, clauses[0]!.id);
    const { devis } = await creerDepuisAffaire(t.app.db, simatis, affaires[0]!);
    expect((await lireDevis(t.app.db, simatis, devis.id)).clauses).toEqual([
      { titre: 'Paiement', texte: 'À 30 jours.', active: true },
    ]);
  });

  it('sans clause par défaut, un nouveau devis reprend les clauses du dernier', async () => {
    const { devis } = await creerDepuisAffaire(t.app.db, simatis, affaires[2]!);
    expect(devis.clauses).toEqual([{ titre: 'Paiement', texte: 'À 30 jours.', active: true }]);
  });

  it('ne laisse pas une autre instance lire ou changer ces paramètres', async () => {
    const p = await lireParametres(t.app.db, helioval);
    expect(p.clauses).toEqual([]);
    expect(p.reglages.tvaPct).toBe(20);
  });
});
