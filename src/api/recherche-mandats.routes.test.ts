import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { creerMonde, fabrique, type Monde } from '../../test/transfert.js';
import { buildApp } from '../app.js';
import { rechercherDans } from '../crm/recherche.js';
import { rechercherMandats } from '../crm/recherche.js';
import { instances } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';

type Reponse = {
  mandats: {
    instance: { slug: string; nom: string; couleur: string | null };
    personnes: { nom: string }[];
  }[];
};

describe('Recherche dans les mandats', () => {
  let t: TestApp;
  let m: Monde;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;

  beforeAll(async () => {
    t = await setupTestApp();
    m = await creerMonde(t);
    const f = fabrique(t);
    const demo = await createInstance(t.owner.db, {
      slug: 'demo-r',
      nom: 'Démo R',
      type: 'prospect',
    });
    const ancien = await createInstance(t.owner.db, {
      slug: 'ancien',
      nom: 'Ancien',
      type: 'mandat',
    });
    await f.contact(m.a, 'Dupont Fictif');
    await f.contact(m.b, 'Martin Fictif');
    await f.contact(m.siege, 'Dupont Siège');
    await f.contact(demo, 'Dupont Démo');
    await f.contact(ancien, 'Dupont Ancien');
    await t.owner.db
      .update(instances)
      .set({ statut: 'archive' })
      .where(eq(instances.id, ancien.id));
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-recherche-mandats-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  const chercher = (slug: string, q: string, portee = 'mandats') =>
    app.inject({
      method: 'GET',
      url: `/api/i/${slug}/recherche?q=${encodeURIComponent(q)}&portee=${portee}`,
    });

  it('trouve un contact dans le mandat qui l’a, et seulement celui-là', async () => {
    const r = await chercher('siege', 'dupont');
    expect(r.statusCode).toBe(200);
    const { mandats } = r.json<Reponse>();
    expect(mandats).toHaveLength(1);
    expect(mandats[0]?.instance).toMatchObject({ slug: 'mandat-a', nom: 'Mandat A' });
    expect(mandats[0]?.personnes.map((p) => p.nom)).toEqual(['Dupont Fictif']);
  });

  it('n’interroge ni le siège, ni une démonstration, ni un mandat archivé', async () => {
    const noms = (await chercher('siege', 'dupont'))
      .json<Reponse>()
      .mandats.flatMap((x) => x.personnes.map((p) => p.nom));
    expect(noms).not.toContain('Dupont Siège');
    expect(noms).not.toContain('Dupont Démo');
    expect(noms).not.toContain('Dupont Ancien');
  });

  it('un mandat ne voit jamais les données d’un autre', async () => {
    const { mandats } = (await chercher('siege', 'martin')).json<Reponse>();
    expect(mandats.map((x) => x.instance.slug)).toEqual(['mandat-b']);
  });

  it('refuse (403) hors de l’instance propre, même avec une recherche vide', async () => {
    expect((await chercher('mandat-a', 'dupont')).statusCode).toBe(403);
    expect((await chercher('mandat-a', '')).statusCode).toBe(403);
  });

  it('garde la recherche ordinaire inchangée sans portée', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/i/siege/recherche?q=dupont' });
    expect(r.json()).toMatchObject({ personnes: [{ nom: 'Dupont Siège' }] });
    expect(r.json()).not.toHaveProperty('mandats');
  });

  it('répond 400 à une portée inconnue et vide sous deux caractères', async () => {
    expect((await chercher('siege', 'dupont', 'tout')).statusCode).toBe(400);
    expect((await chercher('siege', 'd')).json<Reponse>()).toEqual({ mandats: [], echecs: [] });
  });

  it('garde les résultats des autres mandats quand l’un échoue, et le signale sans son erreur', async () => {
    const erreurs: string[] = [];
    const res = await rechercherMandats(
      t.app.db,
      'fictif',
      (db, instance, q) => {
        if (instance.slug === 'mandat-b') throw new Error('panne simulée');
        return rechercherDans(db, instance, q);
      },
      (instance) => erreurs.push(instance.slug),
    );
    expect(res.resultats.map((x) => x.instance.slug)).toEqual(['mandat-a']);
    expect(res.echecs).toEqual(['Mandat B']);
    expect(JSON.stringify(res)).not.toContain('panne simulée');
    expect(erreurs).toEqual(['mandat-b']);
  });

  it('lit les mandats un par un, pour ne pas épuiser les connexions', async () => {
    let enCours = 0;
    let max = 0;
    await rechercherMandats(t.app.db, 'fictif', async (db, instance, q) => {
      enCours++;
      max = Math.max(max, enCours);
      try {
        return await rechercherDans(db, instance, q);
      } finally {
        enCours--;
      }
    });
    expect(max).toBe(1);
  });

  it('annonce les mandats non lus dans la réponse, et accepte une recherche en double paramètre', async () => {
    const r = await chercher('siege', 'dupont');
    expect(r.json<{ echecs: string[] }>().echecs).toEqual([]);
    const double = await app.inject({
      method: 'GET',
      url: '/api/i/siege/recherche?q=a&q=b&portee=mandats',
    });
    expect(double.statusCode).toBe(200);
  });
});
