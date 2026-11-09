import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';
import type { AnalyseImport } from './import.js';

describe('Routes Gestion — import des transactions', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    await createInstance(t.owner.db, {
      slug: 'imp-propre',
      nom: 'Mon activité',
      type: 'propre',
      config: { modules: ['gestion'] },
    });
    await createInstance(t.owner.db, { slug: 'imp-mandat', nom: 'Mandat', type: 'mandat' });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  // CSV à point-virgule et virgule décimale, comme un export français ouvert dans Excel.
  const csv = (...l: string[]) =>
    Buffer.from(['Date;Libellé;Montant;Compte Bancaire;État', ...l].join('\n'), 'utf8').toString(
      'base64',
    );
  const LIGNES = [
    '2026-10-15;Abonnement fictif;-23,99;Compte fictif;Transaction finalisée',
    '2026-10-16;Paiement fictif;-1 260,00;Compte fictif;Transaction finalisée',
    '2026-10-17;Paiement en attente;-5,00;Compte fictif;En attente',
  ];
  const poster = (chemin: string, corps: object, slug = 'imp-propre') =>
    app.inject({
      method: 'POST',
      url: `/api/i/${slug}/gestion/import/${chemin}`,
      payload: corps,
    });
  const fichier = (contenuBase64: string) => ({ nomFichier: 'transactions.csv', contenuBase64 });

  it('refuse hors de « Mon activité »', async () => {
    const r = await poster('analyse', fichier(csv(...LIGNES)), 'imp-mandat');
    expect(r.statusCode).toBe(403);
  });

  it('analyse un CSV français sans rien écrire', async () => {
    const r = await poster('analyse', fichier(csv(...LIGNES)));
    expect(r.statusCode).toBe(200);
    const a = r.json<AnalyseImport>();
    expect(a.compteurs).toEqual({ nouvelles: 2, deja: 0, aVerifier: 0, nonFinalisees: 1 });
    expect(a.lignes.map((l) => l.montantCents)).toEqual([-2399, -126_000]);
    const n = await t.owner.pool.query<{ n: number }>(
      'select count(*)::int as n from gestion_depenses',
    );
    expect(n.rows[0]!.n).toBe(0);
  });

  it('valide, puis ne recrée rien au second envoi du même fichier', async () => {
    const corps = fichier(csv(...LIGNES));
    const premiere = await poster('valider', corps);
    expect(premiere.statusCode).toBe(200);
    expect(premiere.json()).toEqual({ importees: 2, rapprochees: 0, ignorees: 0 });
    const seconde = await poster('valider', corps);
    expect(seconde.json()).toEqual({ importees: 0, rapprochees: 0, ignorees: 0 });
    const a = (await poster('analyse', corps)).json<AnalyseImport>();
    expect(a.compteurs).toMatchObject({ deja: 2, nouvelles: 0 });
    const n = await t.owner.pool.query<{ n: number }>(
      'select count(*)::int as n from gestion_depenses',
    );
    expect(n.rows[0]!.n).toBe(2);
  });

  it('nomme la colonne manquante', async () => {
    const r = await poster(
      'analyse',
      fichier(Buffer.from('Date;Libellé\n2026-10-15;X', 'utf8').toString('base64')),
    );
    expect(r.statusCode).toBe(400);
    expect(r.json<{ error: string }>().error).toContain('Montant');
  });

  it('refuse un rapprochement impossible, un corps invalide et un fichier binaire', async () => {
    const corps = fichier(
      csv('2026-10-20;Nouveau fictif;-9,00;Compte fictif;Transaction finalisée'),
    );
    const cle = (await poster('analyse', corps)).json<AnalyseImport>().lignes[0]!.cle;
    const impossible = await poster('valider', { ...corps, decisions: { [cle]: 'rapprocher' } });
    expect(impossible.statusCode).toBe(400);
    expect(
      (await poster('valider', { ...corps, decisions: { [cle]: 'peut-etre' } })).statusCode,
    ).toBe(400);
    expect((await poster('analyse', { nomFichier: 'x.csv' })).statusCode).toBe(400);
    const binaire = Buffer.from([0x61, 0x00, 0x62, 0x00]).toString('base64');
    expect((await poster('analyse', fichier(binaire))).statusCode).toBe(400);
  });
});
