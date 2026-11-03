import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';
import type { SuiviCca } from './cca.js';
import type { EtatIkMois } from './ik.js';

// Données fictives : aucun taux, lieu ni distance réels.
const TRANCHES = [
  { deKm: 0, jusquaKm: 100, tauxDixMilliemes: 5000, forfaitCents: 0 },
  { deKm: 100, jusquaKm: null, tauxDixMilliemes: 3000, forfaitCents: 2000 },
];

describe('Routes Gestion — IK et compte courant d’associé', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  const base = '/api/i/ik-propre/gestion';
  let vehiculeId = '';

  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    await createInstance(t.owner.db, {
      slug: 'ik-propre',
      nom: 'Mon activité',
      type: 'propre',
      config: { modules: ['gestion'] },
    });
    await createInstance(t.owner.db, { slug: 'ik-mandat', nom: 'Mandat', type: 'mandat' });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const envoyer = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `${base}${url}`, payload });
  const etat = async (mois: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `${base}/ik/etat?mois=${mois}&vehiculeId=${vehiculeId}`,
      })
    ).json<EtatIkMois>();
  const cca = async () =>
    (await app.inject({ method: 'GET', url: `${base}/cca` })).json<SuiviCca>();
  const trajet = (date: string, km: number, nom = 'Domicile à Lieu A') =>
    envoyer('POST', '/ik/trajets', {
      vehiculeId,
      date,
      trajet: nom,
      commentaire: 'Réunion fictive',
      kmAllerRetour: km,
    });

  it('refuse hors de « Mon activité » avec le module', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/i/ik-mandat/gestion/cca' });
    expect(r.statusCode).toBe(403);
  });

  it('sans barème validé : trajets saisis, aucun montant inventé', async () => {
    const v = await envoyer('POST', '/ik/vehicules', { libelle: 'Voiture', categorie: 'auto' });
    vehiculeId = v.json<{ id: string }>().id;
    expect((await trajet('2026-03-04', 80)).statusCode).toBe(200);
    const e = await etat('2026-03');
    expect(e.totalKm).toBe(80);
    expect(e.totalIndemniteCents).toBeNull();
    expect(e.lignes[0]!.indemniteCents).toBeNull();
    expect(e.avertissements.join(' ')).toMatch(/Aucun barème validé/);
  });

  it('refuse un doublon de trajet le même jour', async () => {
    const r = await trajet('2026-03-04', 80);
    expect(r.statusCode).toBe(400);
  });

  it('refuse un barème incohérent, versionne et ne sert qu’après validation', async () => {
    const mauvais = await envoyer('POST', '/ik/baremes', {
      annee: 2026,
      categorie: 'auto',
      source: 'test',
      tranches: [{ deKm: 10, jusquaKm: null, tauxDixMilliemes: 1, forfaitCents: 0 }],
    });
    expect(mauvais.statusCode).toBe(400);
    const b = await envoyer('POST', '/ik/baremes', {
      annee: 2026,
      categorie: 'auto',
      source: 'Barème fictif de test',
      tranches: TRANCHES,
    });
    expect(b.json<{ version: number }>().version).toBe(1);
    expect((await etat('2026-03')).totalIndemniteCents).toBeNull();
    await envoyer('POST', `/ik/baremes/${b.json<{ id: string }>().id}/valider`, {
      date: '2026-11-03',
    });
    expect((await etat('2026-03')).totalIndemniteCents).toBe(80 * 50);
  });

  it('calcule le mois suivant au cumul annuel, pas km × taux', async () => {
    await trajet('2026-04-02', 50, 'Domicile à Lieu B');
    const e = await etat('2026-04');
    // Cumul 130 km (> 100) : tranche 2 sur l'ensemble, moins ce qui était déjà indemnisé.
    expect(e.cumulAnnuelKm).toBe(130);
    expect(e.totalIndemniteCents).toBe(Math.round(130 * 30) + 2000 - 80 * 50);
  });

  it('calcul ≠ comptabilisation : le CCA ne bouge pas avant l’écriture du comptable', async () => {
    expect((await cca()).confirmeCents).toBeNull();
    const mois = '2026-03';
    for (const action of ['a_controler'] as const)
      expect(
        (await envoyer('POST', `/ik/mois/${mois}/avancer`, { vehiculeId, action })).statusCode,
      ).toBe(200);
    // Valider exige l'indicateur d'abonnement, jamais deviné.
    const sans = await envoyer('POST', `/ik/mois/${mois}/avancer`, {
      vehiculeId,
      action: 'valide',
    });
    expect(sans.statusCode).toBe(400);
    await envoyer('PUT', `/ik/mois/${mois}/abonnement`, { abonnement: false });
    expect(
      (await envoyer('POST', `/ik/mois/${mois}/avancer`, { vehiculeId, action: 'valide' }))
        .statusCode,
    ).toBe(200);
    expect((await cca()).mouvements).toHaveLength(0);
    // Un trajet validé est figé.
    const id = (await etat(mois)).lignes[0]!.id;
    expect((await envoyer('PATCH', `/ik/trajets/${id}`, { kmAllerRetour: 10 })).statusCode).toBe(
      400,
    );
    expect((await envoyer('DELETE', `/ik/trajets/${id}`)).statusCode).toBe(400);
  });

  it('exige source et date pour comptabiliser, sans double mouvement', async () => {
    const mois = '2026-03';
    const sansSource = await envoyer('POST', `/ik/mois/${mois}/avancer`, {
      vehiculeId,
      action: 'comptabilise',
    });
    expect(sansSource.statusCode).toBe(400);
    const ok = await envoyer('POST', `/ik/mois/${mois}/avancer`, {
      vehiculeId,
      action: 'comptabilise',
      date: '2026-04-30',
      source: 'Écriture fictive',
    });
    expect(ok.statusCode).toBe(200);
    // Relancer ne recrée rien : plus de trajet à ce statut.
    const encore = await envoyer('POST', `/ik/mois/${mois}/avancer`, {
      vehiculeId,
      action: 'comptabilise',
      date: '2026-04-30',
      source: 'Écriture fictive',
    });
    expect(encore.statusCode).toBe(400);
    const s = await cca();
    expect(s.mouvements.filter((m) => m.type === 'ik')).toHaveLength(1);
    // Sans solde d'ouverture, pas de solde affiché (jamais zéro par défaut).
    expect(s.confirmeCents).toBeNull();
  });

  it('solde d’ouverture confirmé, prévisionnel séparé, remboursement ≠ avance', async () => {
    const ouv = await envoyer('POST', '/cca/mouvements', {
      date: '2026-01-01',
      type: 'ouverture',
      libelle: "Solde d'ouverture",
      montantCents: 100000,
      etat: 'comptabilise',
      source: 'Bilan fictif',
    });
    expect(ouv.statusCode).toBe(200);
    const second = await envoyer('POST', '/cca/mouvements', {
      date: '2026-01-02',
      type: 'ouverture',
      libelle: 'Autre',
      montantCents: 1,
      etat: 'comptabilise',
      source: 'x',
    });
    expect(second.statusCode).toBe(400);
    await envoyer('POST', '/cca/mouvements', {
      date: '2026-05-01',
      type: 'loyer',
      libelle: 'Loyer prévu',
      montantCents: 40000,
    });
    const s = await cca();
    expect(s.confirmeCents).toBe(100000 + 80 * 50);
    expect(s.estimeCents).toBe(100000 + 80 * 50 + 40000);
    // Le remboursement des IK est un débit : il ne se confond pas avec une avance de l'associé.
    await envoyer('POST', '/ik/mois/2026-03/avancer', {
      vehiculeId,
      action: 'rembourse',
      date: '2026-05-05',
      source: 'Virement fictif',
    });
    expect((await cca()).confirmeCents).toBe(100000);
  });

  it('refuse de comptabiliser un mouvement sans source', async () => {
    const r = await envoyer('POST', '/cca/mouvements', {
      date: '2026-06-01',
      type: 'apport',
      libelle: 'Apport',
      montantCents: 1000,
      etat: 'comptabilise',
    });
    expect(r.statusCode).toBe(400);
  });

  it('exporte un CSV UTF-8 avec total, sans péage, formules neutralisées', async () => {
    await envoyer('POST', '/ik/trajets', {
      vehiculeId,
      date: '2026-04-09',
      trajet: '=CMD()',
      commentaire: 'Fictif; "guillemets"',
      kmAllerRetour: 5,
    });
    const r = await app.inject({
      method: 'GET',
      url: `${base}/ik/export.csv?mois=2026-04&vehiculeId=${vehiculeId}`,
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(
      r.body.startsWith(
        String.fromCharCode(0xfeff) + 'Date;Trajet;Commentaire;Distance A/R (km);Indemnité (€)',
      ),
    ).toBe(true);
    expect(r.body).toContain("'=CMD()");
    expect(r.body).toContain('"Fictif; ""guillemets"""');
    expect(r.body).toContain('Total;;;');
    expect(r.body.toLowerCase()).not.toContain('péage;');
  });
});
