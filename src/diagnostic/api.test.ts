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

  it('version finale du deck : cocher, relancer la capitalisation, refuser un lien étranger ou un corps invalide', async () => {
    const projet = await creerProjet('Deck final API');
    const lien = 'https://claude.ai/artifact/DeckApiFictif01';
    await t.owner.db
      .update(diagnosticProjets)
      .set({ restitutionLiens: [{ lien, le: '2026-10-29T10:00:00.000Z' }] })
      .where(eq(diagnosticProjets.id, projet.id));
    const base = `/api/i/simatis/diagnostic/projets/${projet.id}/restitution`;
    const sansFinale = await app.inject({ method: 'POST', url: `${base}/regles` });
    expect(sansFinale.statusCode).toBe(409);
    const ok = await app.inject({
      method: 'POST',
      url: `${base}/finale`,
      payload: { lien, finale: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(
      ok.json<{ restitutionLiens: { finale?: boolean }[] }>().restitutionLiens[0]?.finale,
    ).toBe(true);
    const etranger = await app.inject({
      method: 'POST',
      url: `${base}/finale`,
      payload: { lien: 'https://claude.ai/artifact/Autre', finale: true },
    });
    expect(etranger.statusCode).toBe(409);
    const invalide = await app.inject({ method: 'POST', url: `${base}/finale`, payload: { lien } });
    expect(invalide.statusCode).toBe(400);
    const mauvais = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/diagnostic/projets/pas-un-uuid/restitution/regles',
    });
    expect(mauvais.statusCode).toBe(400);
  });

  it('réglage Relire les finaux : actif par défaut, modifiable, sans toucher au reste de la config', async () => {
    const avant = (await getInstanceBySlug(t.owner.db, 'simatis'))!;
    const url = '/api/i/simatis/diagnostic/reglages';
    expect((await app.inject({ method: 'GET', url })).json()).toEqual({
      relireFinaux: true,
      relireSupports: true,
      relireRestitutions: true,
    });
    const coupe = await app.inject({ method: 'PUT', url, payload: { relireFinaux: false } });
    expect(coupe.statusCode).toBe(200);
    expect(coupe.json()).toEqual({
      relireFinaux: false,
      relireSupports: true,
      relireRestitutions: true,
    });
    expect((await app.inject({ method: 'GET', url })).json()).toEqual({
      relireFinaux: false,
      relireSupports: true,
      relireRestitutions: true,
    });
    const apres = (await getInstanceBySlug(t.owner.db, 'simatis'))!;
    expect(apres.config.modules).toEqual(avant.config.modules);
    expect(apres.config.ecrituresReelles).toEqual(avant.config.ecrituresReelles);
    const remis = await app.inject({ method: 'PUT', url, payload: { relireFinaux: true } });
    expect(remis.json()).toEqual({
      relireFinaux: true,
      relireSupports: true,
      relireRestitutions: true,
    });
    const supports = await app.inject({ method: 'PUT', url, payload: { relireSupports: false } });
    expect(supports.json()).toEqual({
      relireFinaux: true,
      relireSupports: false,
      relireRestitutions: true,
    });
    const decks = await app.inject({ method: 'PUT', url, payload: { relireRestitutions: false } });
    expect(decks.json()).toEqual({
      relireFinaux: true,
      relireSupports: false,
      relireRestitutions: false,
    });
    await app.inject({ method: 'PUT', url, payload: { relireRestitutions: true } });
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

  it('capitaliser le support : refusé sans support final, lancé avec, 400 sur identifiant invalide', async () => {
    const projet = await creerProjet('Support capitalisation API');
    const url = `/api/i/simatis/diagnostic/projets/${projet.id}/support/capitaliser`;
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(409);
    await t.owner.db
      .update(diagnosticProjets)
      .set({
        supportStatut: 'final',
        supportLien: 'https://claude.ai/artifact/AbCdEfGh12',
        supportTexte: [{ titre: 'T', texte: 'X', notes: 'N' }],
      })
      .where(eq(diagnosticProjets.id, projet.id));
    const ok = await app.inject({ method: 'POST', url });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ demande: string }>().demande).toBe('regles_support');
    const mauvais = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/diagnostic/projets/pas-un-uuid/support/capitaliser',
    });
    expect(mauvais.statusCode).toBe(400);
  });

  it('valider la revue lance la capitalisation, une seule fois par validation', async () => {
    const projet = await creerProjet('Revue capitalisation API');
    const url = `/api/i/simatis/diagnostic/projets/${projet.id}`;
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url, payload });
    const demande = async () =>
      (await app.inject({ method: 'GET', url: '/api/i/simatis/diagnostic/projets' }))
        .json<{ id: string; demande: string | null }[]>()
        .find((p) => p.id === projet.id)!.demande;
    const repos = () =>
      t.owner.db
        .update(diagnosticProjets)
        .set({ demande: null, statutChat: 'repos' })
        .where(eq(diagnosticProjets.id, projet.id));
    expect((await patch({ revue: { statut: 'brouillon' } })).statusCode).toBe(200);
    expect(await demande()).toBeNull();
    const valide = await patch({ revue: { statut: 'validée' } });
    expect(valide.statusCode).toBe(200);
    expect(await demande()).toBe('regles_analyse');
    await repos();
    // Une mise à jour qui garde la revue validée, ou qui change autre chose, ne lance rien.
    await patch({ revue: { statut: 'validée', indicateurs: 'x' } });
    await patch({ contexte: 'Autre contexte fictif' });
    expect(await demande()).toBeNull();
    // Revue modifiée (retour en brouillon) puis revalidée : une nouvelle capitalisation.
    await patch({ revue: { statut: 'brouillon' } });
    await patch({ revue: { statut: 'validée' } });
    expect(await demande()).toBe('regles_analyse');
  });

  it('valider la revue pendant que Claude répond garde la revue validée sans erreur', async () => {
    const projet = await creerProjet('Revue occupée API');
    await t.owner.db
      .update(diagnosticProjets)
      .set({ statutChat: 'attente_claude' })
      .where(eq(diagnosticProjets.id, projet.id));
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/i/simatis/diagnostic/projets/${projet.id}`,
      payload: { revue: { statut: 'validée' } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ revue: { statut: string } }>().revue.statut).toBe('validée');
  });

  it('capitaliser l analyse : refusé sans revue validée, lancé avec, 400 sur identifiant invalide', async () => {
    const projet = await creerProjet('Revue capitaliser API');
    const url = `/api/i/simatis/diagnostic/projets/${projet.id}/revue/capitaliser`;
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(409);
    await t.owner.db
      .update(diagnosticProjets)
      .set({ revue: { statut: 'validée' } })
      .where(eq(diagnosticProjets.id, projet.id));
    const ok = await app.inject({ method: 'POST', url });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ demande: string }>().demande).toBe('regles_analyse');
    const mauvais = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/diagnostic/projets/pas-un-uuid/revue/capitaliser',
    });
    expect(mauvais.statusCode).toBe(400);
  });

  it('préparer la revue : refusé sans résultat, lancé avec, 400 sur identifiant invalide', async () => {
    const projet = await creerProjet('Revue préparer API');
    const url = `/api/i/simatis/diagnostic/projets/${projet.id}/revue/preparer`;
    const sans = await app.inject({ method: 'POST', url });
    expect(sans.statusCode).toBe(409);
    await t.owner.db
      .update(diagnosticProjets)
      .set({ dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 } })
      .where(eq(diagnosticProjets.id, projet.id));
    const ok = await app.inject({ method: 'POST', url });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ demande: string }>().demande).toBe('revue_preparer');
    const mauvais = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/diagnostic/projets/pas-un-uuid/revue/preparer',
    });
    expect(mauvais.statusCode).toBe(400);
  });

  it('exporter la revue : refusé sans revue validée, lancé avec, 400 sur identifiant invalide', async () => {
    const projet = await creerProjet('Revue export API');
    const url = `/api/i/simatis/diagnostic/projets/${projet.id}/revue/exporter`;
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(409);
    await t.owner.db
      .update(diagnosticProjets)
      .set({ revue: { statut: 'validée' } })
      .where(eq(diagnosticProjets.id, projet.id));
    const ok = await app.inject({ method: 'POST', url });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ demande: string }>().demande).toBe('revue_exporter');
    const mauvais = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/diagnostic/projets/pas-un-uuid/revue/exporter',
    });
    expect(mauvais.statusCode).toBe(400);
  });

  it('cadrer le rapport : refusé sans résultat, lancé avec, 400 sur identifiant invalide', async () => {
    const projet = await creerProjet('Cadrage rapport API');
    const url = `/api/i/simatis/diagnostic/projets/${projet.id}/rapport/cadrer`;
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(409);
    await t.owner.db
      .update(diagnosticProjets)
      .set({ dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 } })
      .where(eq(diagnosticProjets.id, projet.id));
    const ok = await app.inject({ method: 'POST', url });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ demande: string }>().demande).toBe('rapport_cadrer');
    const mauvais = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/diagnostic/projets/pas-un-uuid/rapport/cadrer',
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
