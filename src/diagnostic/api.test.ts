import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { eq } from 'drizzle-orm';
import { entreprises } from '../crm/schema.js';
import { diagnosticProjets, diagnosticReglesJournal } from './schema.js';
import { createInstance, getInstanceBySlug } from '../instances/service.js';

// Routes HTTP de l'entretien : import du PDF (corps plus grand que la limite par défaut) et correction.
const grilleFictive = {
  seuil: 6,
  questions: [
    { section: 'R1', numero: 1, libelle: 'Q1', dimension: 'outils', poids: 2 },
    { section: 'R1', numero: 2, libelle: 'Q2', dimension: 'outils', poids: 1 },
    { section: 'R2', numero: 1, libelle: 'Q3', dimension: 'strategie', poids: 1 },
    { section: 'R2', numero: 2, libelle: 'Q4', dimension: 'strategie', poids: 1 },
    { section: 'R3', numero: 1, libelle: 'Q5', dimension: 'polyvalence', poids: 1 },
  ],
};

describe('Entretien : API', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let dossier: string;
  let grilleAvant: string | undefined;

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    dossier = await mkdtemp(path.join(tmpdir(), 'entretien-api-'));
    const chemin = path.join(dossier, 'grille.json');
    await writeFile(chemin, JSON.stringify(grilleFictive));
    grilleAvant = process.env.DIAGNOSTIC_GRILLE;
    process.env.DIAGNOSTIC_GRILLE = chemin;
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir: dossier,
      realWrites: false,
    });
  });

  afterAll(async () => {
    if (grilleAvant === undefined) delete process.env.DIAGNOSTIC_GRILLE;
    else process.env.DIAGNOSTIC_GRILLE = grilleAvant;
    await app.close();
    await rm(dossier, { recursive: true, force: true });
    await t.drop();
  });

  const pdf = (taille: number) =>
    Buffer.concat([Buffer.from('%PDF-1.4 '), Buffer.alloc(taille)]).toString('base64');

  const creerProjet = async (nom: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/diagnostic/projets',
      payload: { nom, activite: 'services' },
    });
    return r.json<{ id: string }>();
  };

  it('refuse le rattachement à une entreprise d une autre instance', async () => {
    const autre = await createInstance(t.owner.db, {
      slug: 'rattach-croise',
      nom: 'Autre',
      type: 'propre',
    });
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: autre.id, nom: 'Entreprise Fictive Z' })
      .returning({ id: entreprises.id });
    const r = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/diagnostic/projets',
      payload: { nom: 'Rattachement croisé', activite: 'services', entrepriseId: e!.id },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json<{ error: string }>().error).toMatch(/entreprise/i);
  });

  it('rattache un projet à une entreprise de la même instance', async () => {
    const simatis = (await getInstanceBySlug(t.owner.db, 'simatis'))!;
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: simatis.id, nom: 'Entreprise Fictive Y' })
      .returning({ id: entreprises.id });
    const r = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/diagnostic/projets',
      payload: { nom: 'Rattachement local', activite: 'services', entrepriseId: e!.id },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ entrepriseId: string }>().entrepriseId).toBe(e!.id);
  });

  it('accepte un PDF de 2 Mo, plus grand que la limite par défaut de la route', async () => {
    const projet = await creerProjet('Entretien Fictif API A');
    const r = await app.inject({
      method: 'POST',
      url: `/api/i/simatis/diagnostic/projets/${projet.id}/entretien`,
      payload: { nom: 'entretien.pdf', base64: pdf(2 * 1024 * 1024) },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ demande: string }>().demande).toBe('entretien');
  });

  it('refuse une correction tant qu aucune réponse n a été lue', async () => {
    const projet = await creerProjet('Entretien Fictif API B');
    const r = await app.inject({
      method: 'POST',
      url: `/api/i/simatis/diagnostic/projets/${projet.id}/entretien/reponse`,
      payload: { section: 'R1', numero: 1, reponse: 'A' },
    });
    expect(r.statusCode).toBe(409);
  });

  it('refuse de vider une étape qui n existe pas', async () => {
    const projet = await creerProjet('Entretien Fictif API C');
    const r = await app.inject({
      method: 'POST',
      url: `/api/i/simatis/diagnostic/projets/${projet.id}/messages/vider`,
      payload: { etape: 9 },
    });
    expect(r.statusCode).toBe(400);
  });

  it('supprime un projet, et refuse un projet d une autre instance', async () => {
    const projet = await creerProjet('Suppression Fictive');
    const supprime = await app.inject({
      method: 'DELETE',
      url: `/api/i/simatis/diagnostic/projets/${projet.id}`,
    });
    expect(supprime.statusCode).toBe(200);
    const liste = await app.inject({ method: 'GET', url: '/api/i/simatis/diagnostic/projets' });
    expect(liste.json<{ id: string }[]>().some((p) => p.id === projet.id)).toBe(false);

    const encore = await app.inject({
      method: 'DELETE',
      url: `/api/i/simatis/diagnostic/projets/${projet.id}`,
    });
    expect(encore.statusCode).toBe(404);
    const mauvais = await app.inject({
      method: 'DELETE',
      url: '/api/i/simatis/diagnostic/projets/pas-un-uuid',
    });
    expect(mauvais.statusCode).toBe(400);
  });

  it('version finale du rapport : cocher, refuser un lien étranger, refuser un corps invalide', async () => {
    const simatis = (await getInstanceBySlug(t.owner.db, 'simatis'))!;
    const projet = await creerProjet('Version finale API');
    const lien = 'https://docs.google.com/document/d/doc-api-1/edit';
    await t.owner.db
      .update(diagnosticProjets)
      .set({ rapportLiens: [{ lien, le: '2026-10-29T10:00:00.000Z', version: 4 }] })
      .where(eq(diagnosticProjets.id, projet.id));
    expect(simatis.slug).toBe('simatis');
    const url = `/api/i/simatis/diagnostic/projets/${projet.id}/rapport/finale`;
    const ok = await app.inject({ method: 'POST', url, payload: { lien, finale: true } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ rapportLiens: { finale?: boolean }[] }>().rapportLiens[0]?.finale).toBe(true);
    const etranger = await app.inject({
      method: 'POST',
      url,
      payload: { lien: 'https://docs.google.com/document/d/autre/edit', finale: true },
    });
    expect(etranger.statusCode).toBe(409);
    const invalide = await app.inject({ method: 'POST', url, payload: { lien } });
    expect(invalide.statusCode).toBe(400);
    const mauvais = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/diagnostic/projets/pas-un-uuid/rapport/finale',
      payload: { lien, finale: true },
    });
    expect(mauvais.statusCode).toBe(400);
  });

  it('réglage Relire les finaux : actif par défaut, modifiable, sans toucher au reste de la config', async () => {
    const avant = (await getInstanceBySlug(t.owner.db, 'simatis'))!;
    const url = '/api/i/simatis/diagnostic/reglages';
    expect((await app.inject({ method: 'GET', url })).json()).toEqual({
      relireFinaux: true,
      relireSupports: true,
    });
    const coupe = await app.inject({ method: 'PUT', url, payload: { relireFinaux: false } });
    expect(coupe.statusCode).toBe(200);
    expect(coupe.json()).toEqual({ relireFinaux: false, relireSupports: true });
    expect((await app.inject({ method: 'GET', url })).json()).toEqual({
      relireFinaux: false,
      relireSupports: true,
    });
    const apres = (await getInstanceBySlug(t.owner.db, 'simatis'))!;
    expect(apres.config.modules).toEqual(avant.config.modules);
    expect(apres.config.ecrituresReelles).toEqual(avant.config.ecrituresReelles);
    const remis = await app.inject({ method: 'PUT', url, payload: { relireFinaux: true } });
    expect(remis.json()).toEqual({ relireFinaux: true, relireSupports: true });
    const supports = await app.inject({ method: 'PUT', url, payload: { relireSupports: false } });
    expect(supports.json()).toEqual({ relireFinaux: true, relireSupports: false });
    const vide = await app.inject({ method: 'PUT', url, payload: {} });
    expect(vide.statusCode).toBe(400);
    await app.inject({ method: 'PUT', url, payload: { relireSupports: true } });
    const invalide = await app.inject({ method: 'PUT', url, payload: { relireFinaux: 'oui' } });
    expect(invalide.statusCode).toBe(400);
  });

  it('journal des règles : liste vide, capitaliser sans finale, annuler une entrée', async () => {
    const simatis = (await getInstanceBySlug(t.owner.db, 'simatis'))!;
    const vide = await app.inject({
      method: 'GET',
      url: '/api/i/simatis/diagnostic/regles-journal',
    });
    expect(vide.statusCode).toBe(200);
    expect(vide.json()).toEqual([]);
    const projet = await creerProjet('Journal API');
    const base = `/api/i/simatis/diagnostic/projets/${projet.id}`;
    const sansFinale = await app.inject({ method: 'POST', url: `${base}/rapport/capitaliser` });
    expect(sansFinale.statusCode).toBe(409);
    await t.owner.db.insert(diagnosticReglesJournal).values({
      instanceId: simatis.id,
      projetId: projet.id,
      fiche: 'rapport',
      action: 'ajoutée',
      libelle: 'Règle fictive',
      avant: null,
      apres: 'Règle fictive complète',
      origine: 'version finale 4',
    });
    const [entree] = (
      await app.inject({ method: 'GET', url: '/api/i/simatis/diagnostic/regles-journal' })
    ).json<{ id: string }[]>();
    const annule = await app.inject({
      method: 'POST',
      url: `${base}/regles-journal/${entree!.id}/annuler`,
    });
    expect(annule.statusCode).toBe(200);
    expect(annule.json<{ demande: string }>().demande).toBe('regles_annuler');
    const inconnue = await app.inject({
      method: 'POST',
      url: `${base}/regles-journal/00000000-0000-4000-8000-000000000099/annuler`,
    });
    expect(inconnue.statusCode).toBe(409);
    const mauvais = await app.inject({
      method: 'POST',
      url: `${base}/regles-journal/pas-un-uuid/annuler`,
    });
    expect(mauvais.statusCode).toBe(400);
  });

  it('refuse un identifiant de projet mal formé', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/diagnostic/projets/pas-un-uuid/entretien',
      payload: { nom: 'entretien.pdf', base64: pdf(10) },
    });
    expect(r.statusCode).toBe(400);
  });
});
