import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { activites, contacts } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { actualiserHistorique, alertesDe } from './historique.js';
import { integrerFiches } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import { apercu, creerImports, exporterCsv, listerFiches, modifierConformite } from './service.js';

const joursAvant = (n: number) => new Date(Date.now() - n * 864e5);

describe('base vivante : historique, alertes, filtres, export', () => {
  let t: TestApp;
  let base: Instance;
  let mandatA: Instance;
  let mandatB: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-h-base', nom: 'Base', type: 'propre' });
    mandatA = await createInstance(t.owner.db, { slug: 'bv-h-a', nom: 'Mandat A', type: 'mandat' });
    mandatB = await createInstance(t.owner.db, { slug: 'bv-h-b', nom: 'Mandat B', type: 'mandat' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    for (const table of [
      'base_reponses',
      'base_lignes_brutes',
      'base_vivante',
      'base_imports',
      'base_correspondances',
      'activites',
      'contacts',
    ])
      await t.owner.pool.query(`delete from ${table}`);
  });

  const fiche = (brut: Brut) => normaliserFiche(brut).fiche;
  const integrer = async (...brutes: Brut[]) => {
    const res = await withInstance(t.app.db, base.id, (tx) =>
      integrerFiches(
        tx,
        base.id,
        brutes.map((b) => ({
          fiche: fiche(b),
          provenance: 'Sharp',
          mandat: null,
          importId: null,
          collecteLe: null,
        })),
      ),
    );
    return res.map((r) => r.id);
  };
  const contactCrm = async (
    instance: Instance,
    email: string,
    activitesDe: { type: string; at: Date }[],
  ) => {
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: instance.id, nom: 'Contact fictif', email })
      .returning();
    for (const a of activitesDe)
      await t.owner.db
        .insert(activites)
        .values({ instanceId: instance.id, contactId: c?.id ?? null, ...a });
  };
  const lire = async () => (await listerFiches(t.app.db, base.id, { limite: 200 })).fiches;

  it('lit le dernier contact dans le CRM de tous les mandats, sans le contenu des échanges', async () => {
    await integrer(
      { entreprise: 'Atelier Fictif', prenom: 'Léa', nom: 'Martin', email: 'lea@atelier.test' },
      { entreprise: 'Bureau Fictif', prenom: 'Paul', nom: 'Petit', email: 'paul@bureau.test' },
    );
    await contactCrm(mandatA, 'LEA@atelier.test', [
      { type: 'email', at: joursAvant(400) },
      { type: 'note', at: joursAvant(1) },
    ]);
    await contactCrm(mandatB, 'lea@atelier.test', [{ type: 'appel', at: joursAvant(40) }]);
    expect(await actualiserHistorique(t.app.db, base.id)).toEqual({ verifiees: 2, trouvees: 1 });
    const fiches = await lire();
    const lea = fiches.find((f) => f.nom === 'MARTIN');
    expect(lea).toMatchObject({
      dernierContactCanal: 'appel',
      mandatContacteur: 'Mandat B',
      nbContacts: 2,
      statutProspection: 'contacte',
    });
    expect(lea?.dernierContactLe?.getTime()).toBeGreaterThan(joursAvant(41).getTime());
    expect(fiches.find((f) => f.nom === 'PETIT')?.statutProspection).toBe('jamais_contacte');
  });

  it('un contact du CRM sans aucune activité ne compte pas comme contacté', async () => {
    await integrer({ entreprise: 'Atelier Fictif', nom: 'Martin', email: 'm@atelier.test' });
    await contactCrm(mandatA, 'm@atelier.test', []);
    await actualiserHistorique(t.app.db, base.id);
    expect((await lire())[0]).toMatchObject({
      statutProspection: 'jamais_contacte',
      nbContacts: 0,
    });
  });

  it('alerte 6 mois après le dernier contact, puis plus', () => {
    const f = {
      opposition: false,
      exclusion: null,
      emailInvalide: false,
      mandatContacteur: 'Mandat A',
      crmMandat: null,
    };
    expect(alertesDe({ ...f, dernierContactLe: joursAvant(60) }).map((a) => a.code)).toEqual([
      'recontact',
    ]);
    expect(alertesDe({ ...f, dernierContactLe: joursAvant(250) })).toEqual([]);
    expect(
      alertesDe({ ...f, opposition: true, exclusion: 'client', dernierContactLe: null }).map(
        (a) => [a.code, a.bloquante],
      ),
    ).toEqual([
      ['opposition', true],
      ['exclusion', true],
    ]);
  });

  it('prévient à l’aperçu quand une ligne est déjà connue, sans bloquer', async () => {
    await integrer({
      entreprise: 'Atelier Fictif',
      prenom: 'Léa',
      nom: 'Martin',
      email: 'lea@atelier.test',
    });
    await contactCrm(mandatA, 'paul@bureau.test', [{ type: 'email', at: joursAvant(30) }]);
    const [imp] = await creerImports(t.app.db, base.id, {
      nomFichier: 'x.csv',
      contenu: Buffer.from(
        'Société;Prénom;Nom;Email\nAtelier Fictif;Léa;Martin;lea@atelier.test\nBureau Fictif;Paul;Petit;paul@bureau.test\nCabinet;Zoé;Neuve;zoe@cabinet.test',
      ),
      provenance: 'Test',
    });
    const lignes = (await apercu(t.app.db, base.id, imp?.id ?? '')).lignes;
    expect(lignes[0]?.alertes).toEqual(['Déjà dans la base : les informations seront fusionnées']);
    expect(lignes[1]?.alertes[0]).toMatch(/^Contacté par Mandat A le .* : recontact avant 6 mois/);
    expect(lignes[2]?.alertes).toEqual([]);
    expect(imp?.compteurs.prospectables).toBe(3);
  });

  it('une adresse en erreur ou une opposition change la zone et les alertes', async () => {
    const [avecTel, sansTel] = await integrer(
      { entreprise: 'A Fictif', nom: 'Un', email: 'un@a.test', telephone: '0612345678' },
      { entreprise: 'B Fictif', nom: 'Deux', email: 'deux@b.test' },
    );
    await modifierConformite(t.app.db, base.id, avecTel ?? '', { emailInvalide: true });
    await modifierConformite(t.app.db, base.id, sansTel ?? '', {
      emailInvalide: true,
      opposition: true,
      exclusion: 'concurrent',
    });
    const fiches = await lire();
    expect(fiches.find((f) => f.nom === 'UN')).toMatchObject({ zone: 'prospectable' });
    const deux = fiches.find((f) => f.nom === 'DEUX');
    expect(deux?.zone).toBe('a_enrichir');
    expect(deux?.alertes.map((a) => a.code)).toEqual(['opposition', 'exclusion', 'email_invalide']);
    await modifierConformite(t.app.db, base.id, sansTel ?? '', { emailInvalide: false });
    expect((await lire()).find((f) => f.nom === 'DEUX')?.zone).toBe('prospectable');
  });

  it('filtre par statut, alerte et source', async () => {
    const [a] = await integrer(
      { entreprise: 'A Fictif', nom: 'Un', email: 'un@a.test' },
      { entreprise: 'B Fictif', nom: 'Deux', email: 'deux@b.test' },
    );
    await contactCrm(mandatA, 'un@a.test', [{ type: 'email', at: joursAvant(10) }]);
    await actualiserHistorique(t.app.db, base.id);
    await modifierConformite(t.app.db, base.id, a ?? '', { opposition: true });
    const noms = async (f: Parameters<typeof listerFiches>[2]) =>
      (await listerFiches(t.app.db, base.id, f)).fiches.map((x) => x.nom);
    expect(await noms({ statut: 'contacte' })).toEqual(['UN']);
    expect(await noms({ statut: 'jamais_contacte' })).toEqual(['DEUX']);
    expect(await noms({ alerte: 'recontact' })).toEqual(['UN']);
    expect(await noms({ alerte: 'opposition' })).toEqual(['UN']);
    expect(await noms({ provenance: 'Autre' })).toEqual([]);
    expect((await listerFiches(t.app.db, base.id)).provenances).toEqual(['Sharp']);
  });

  it('exporte en CSV avec les filtres, neutralise les formules et note NA sans contact', async () => {
    await integrer(
      {
        entreprise: '=CMD("x")',
        prenom: 'Léa',
        nom: 'Martin',
        email: 'lea@a.test',
        fonction: 'Dir; "gén"',
      },
      { entreprise: 'B Fictif', nom: 'Deux', telephone: '0612345678' },
    );
    await contactCrm(mandatA, 'lea@a.test', [{ type: 'email', at: new Date('2026-03-15') }]);
    await actualiserHistorique(t.app.db, base.id);
    const csv = await exporterCsv(t.app.db, base.id);
    expect(csv.startsWith('﻿Entreprise;Civilité;')).toBe(true);
    const lignes = csv.trim().split('\r\n');
    expect(lignes).toHaveLength(3);
    expect(lignes[1]).toContain('"\'=CMD(""x"")"');
    expect(lignes[1]).toContain('"Dir; ""gén"""');
    expect(lignes[1]).toContain(';2026/03;email;');
    expect(lignes[2]).toContain(';NA;');
    const filtre = await exporterCsv(t.app.db, base.id, { statut: 'contacte' });
    expect(filtre.trim().split('\r\n')).toHaveLength(2);
  });

  it('un contact plus ancien n’écrase pas un contact plus récent', async () => {
    const [id] = await integrer({ entreprise: 'A Fictif', nom: 'Un', email: 'un@a.test' });
    await contactCrm(mandatA, 'un@a.test', [{ type: 'email', at: joursAvant(10) }]);
    await actualiserHistorique(t.app.db, base.id);
    await t.owner.pool.query('delete from activites');
    await contactCrm(mandatB, 'un@a.test', [{ type: 'appel', at: joursAvant(100) }]);
    await actualiserHistorique(t.app.db, base.id);
    expect((await lire()).find((f) => f.id === id)).toMatchObject({
      mandatContacteur: 'Mandat A',
      dernierContactCanal: 'email',
    });
  });
});
