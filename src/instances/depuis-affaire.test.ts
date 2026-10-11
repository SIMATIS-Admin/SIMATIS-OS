import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { contacts, entreprises, opportunites } from '../crm/schema.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { creerMandatDepuisAffaire, lierMandat, MandatRefuse, mandatLie } from './depuis-affaire.js';
import type { Instance } from './schema.js';
import { archiveInstance, createInstance, getInstanceBySlug } from './service.js';

describe('mandate created from (or linked to) a deal of the own activity', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let propre: Instance;
  let affaire: string;
  let sansEntreprise: string;
  let homonyme: string;
  let autre: string;

  const count = async (table: string, slug: string) => {
    const { rows } = await t.owner.pool.query<{ n: number }>(
      `select count(*)::int as n from ${table} where instance_id = (select id from instances where slug = $1)`,
      [slug],
    );
    return rows[0]?.n ?? 0;
  };
  const nouvelleAffaire = async (titre: string, entrepriseNom: string | null) => {
    let entrepriseId: string | null = null;
    if (entrepriseNom) {
      const [e] = await t.owner.db
        .insert(entreprises)
        .values({ instanceId: propre.id, nom: entrepriseNom, ville: 'Lyon' })
        .returning({ id: entreprises.id });
      entrepriseId = e?.id ?? null;
    }
    const [o] = await t.owner.db
      .insert(opportunites)
      .values({ instanceId: propre.id, titre, etape: 'qualification', entrepriseId })
      .returning({ id: opportunites.id });
    return { id: o?.id ?? '', entrepriseId };
  };

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    propre = (await getInstanceBySlug(t.owner.db, 'simatis')) as Instance;
    const a = await nouvelleAffaire('Accompagnement commercial', 'Verrerie Alpha');
    affaire = a.id;
    await t.owner.db.insert(contacts).values([
      {
        instanceId: propre.id,
        entrepriseId: a.entrepriseId,
        nom: 'Léa Fictive',
        email: 'lea@example.test',
      },
      { instanceId: propre.id, entrepriseId: a.entrepriseId, nom: 'Paul Fictif' },
    ]);
    sansEntreprise = (await nouvelleAffaire('Affaire orpheline', null)).id;
    homonyme = (await nouvelleAffaire('Seconde affaire', 'Verrerie Alpha')).id;
    autre = (await nouvelleAffaire('Affaire à lier', 'Atelier Beta')).id;
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  it('creates a closing mandate with a copy of the company and its contacts', async () => {
    const m = await creerMandatDepuisAffaire(t.owner.db, propre, affaire, { crm: 'hubspot' });
    expect(m).toMatchObject({ type: 'mandat', nom: 'Verrerie Alpha', slug: 'verrerie-alpha' });
    expect(m.config).toMatchObject({
      phase: 'closing',
      ecrituresReelles: false,
      origine: { opportuniteId: affaire },
    });
    expect(await count('entreprises', m.slug)).toBe(1);
    expect(await count('contacts', m.slug)).toBe(2);
    expect(await count('opportunites', m.slug)).toBe(0);
    expect(await count('devis', m.slug)).toBe(0);
    const { rows } = await t.owner.pool.query<{ source: string; ville: string; n: number }>(
      `select e.source, e.ville, (select count(*)::int from contacts c where c.entreprise_id = e.id) as n
       from entreprises e where e.instance_id = (select id from instances where slug = 'verrerie-alpha')`,
    );
    expect(rows).toEqual([{ source: 'simatis', ville: 'Lyon', n: 2 }]);
    expect(await count('connexions', m.slug)).toBe(3);
    expect(await mandatLie(t.owner.db, affaire)).toEqual({
      slug: 'verrerie-alpha',
      nom: 'Verrerie Alpha',
    });
  });

  it('refuses a second mandate for the same deal', async () => {
    await expect(
      creerMandatDepuisAffaire(t.owner.db, propre, affaire, { crm: null }),
    ).rejects.toThrow(MandatRefuse);
  });

  it('refuses a deal without a company', async () => {
    await expect(
      creerMandatDepuisAffaire(t.owner.db, propre, sansEntreprise, { crm: null }),
    ).rejects.toThrow("L'affaire n'a pas d'entreprise");
  });

  it('suffixes the slug when the name is taken', async () => {
    const m = await creerMandatDepuisAffaire(t.owner.db, propre, homonyme, { crm: null });
    expect(m.slug).toBe('verrerie-alpha-2');
  });

  it('links an existing mandate without copying anything', async () => {
    const avant = await count('entreprises', 'aquaterra');
    const m = await lierMandat(t.owner.db, propre, autre, 'aquaterra');
    expect(m.config.origine?.opportuniteId).toBe(autre);
    expect(await count('entreprises', 'aquaterra')).toBe(avant);
    expect(await mandatLie(t.owner.db, autre)).toEqual({ slug: 'aquaterra', nom: 'Aquaterra' });
  });

  it('refuses to link a demo, an archived instance, an unknown slug or an already linked mandate', async () => {
    const libre = (await nouvelleAffaire('Encore une affaire', 'Atelier Gamma')).id;
    await createInstance(t.owner.db, { slug: 'ancien', nom: 'Ancien', type: 'mandat' });
    await archiveInstance(t.owner.db, 'ancien');
    for (const slug of ['demo', 'ancien', 'inconnu', 'aquaterra', 'simatis']) {
      await expect(lierMandat(t.owner.db, propre, libre, slug)).rejects.toThrow(MandatRefuse);
    }
  });

  it('refuses when called from another instance than Mon activité', async () => {
    const helioval = (await getInstanceBySlug(t.owner.db, 'helioval')) as Instance;
    await expect(
      creerMandatDepuisAffaire(t.owner.db, helioval, affaire, { crm: null }),
    ).rejects.toThrow(MandatRefuse);
  });

  it('exposes creation and the linked mandate through the API', async () => {
    const libre = (await nouvelleAffaire('Affaire API', 'Fonderie Delta')).id;
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
    const res = await post(`/api/i/simatis/opportunites/${libre}/mandat`, { crm: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ slug: 'fonderie-delta', type: 'mandat', phase: 'closing' });
    expect(
      (await post(`/api/i/simatis/opportunites/${libre}/mandat`, { crm: null })).statusCode,
    ).toBe(409);
    expect(
      (await post(`/api/i/simatis/opportunites/${libre}/mandat`, { crm: 'x' })).statusCode,
    ).toBe(400);
    const fiche = await app.inject(`/api/i/simatis/fiches/affaire/${libre}`);
    expect(fiche.json()).toMatchObject({
      mandat: { slug: 'fonderie-delta', nom: 'Fonderie Delta' },
    });
    const lier = await post(`/api/i/simatis/opportunites/${sansEntreprise}/mandat/lier`, {
      slug: 'demo',
    });
    expect(lier.statusCode).toBe(409);
  });
});
