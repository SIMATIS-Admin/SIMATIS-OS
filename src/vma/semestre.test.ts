import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { creerInvitation, SemestreAConfirmer } from './invitations.js';
import { registerVmaRoutes } from './routes.js';

const JETON = 'jeton-semestre-vma-'.padEnd(40, 'k');
const SITE = 'https://site.test';
const JOUR = 24 * 3600 * 1000;
const hex = () => randomBytes(16).toString('hex');

// Faux site : seules les créations d'invitation sont nécessaires ici.
function repondre(init?: RequestInit): Response {
  if (new Headers(init?.headers).get('authorization') !== `Bearer ${JETON}`) {
    return new Response('{}', { status: 401 });
  }
  return Response.json(
    { id: hex(), expireLe: new Date(Date.now() + 30 * JOUR).toISOString() },
    { status: 201 },
  );
}
const fetchSite = ((_url: string | URL, init?: RequestInit) =>
  Promise.resolve(repondre(init))) as typeof globalThis.fetch;

describe('règle du semestre pour le Test de VMA', () => {
  let t: TestApp;
  let mandat: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    mandat = await createInstance(t.owner.db, {
      slug: 'semestre-mandat',
      nom: 'Mandat',
      type: 'mandat',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  beforeEach(async () => {
    await t.owner.pool.query('delete from vma_tests');
  });

  // Une invitation utilisée, dont le résultat est arrivé `joursAvant` jours plus tôt.
  const testRecu = async (
    entrepriseNom: string,
    joursAvant: number,
    type: 'premier' | 'essai' = 'premier',
  ) => {
    const inv = await creerInvitation(
      t.app.db,
      { url: SITE, token: JETON, fetch: fetchSite },
      { instanceId: mandat.id, entrepriseNom, type: 'essai' },
    );
    const recu = new Date(Date.now() - joursAvant * JOUR);
    await t.owner.pool.query(
      "update vma_tests set statut = 'utilisee', recue_le = $1, type = $2 where id = $3",
      [recu, type, inv.id],
    );
    return inv.id;
  };

  const creer = (
    entrepriseNom: string,
    extra: { type?: 'premier' | 'essai'; confirmerSemestre?: boolean } = {},
  ) =>
    creerInvitation(
      t.app.db,
      { url: SITE, token: JETON, fetch: fetchSite },
      {
        instanceId: mandat.id,
        entrepriseNom,
        type: extra.type ?? 'premier',
        ...(extra.confirmerSemestre !== undefined
          ? { confirmerSemestre: extra.confirmerSemestre }
          : {}),
      },
    );

  it("bloque un premier test si l'entreprise en a eu un il y a moins de 182 jours", async () => {
    const dernierId = await testRecu('Atelier Fictif', 10);
    const err = await creer('Atelier Fictif').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SemestreAConfirmer);
    expect((err as SemestreAConfirmer).dernier.id).toBe(dernierId);
  });

  it('crée quand Marc confirme explicitement', async () => {
    await testRecu('Atelier Fictif', 10);
    const cree = await creer('Atelier Fictif', { confirmerSemestre: true });
    expect(cree.statut).toBe('envoyee');
  });

  it('ne bloque pas un essai', async () => {
    await testRecu('Atelier Fictif', 10);
    await expect(creer('Atelier Fictif', { type: 'essai' })).resolves.toMatchObject({
      type: 'essai',
    });
  });

  it('ne compte pas un test plus ancien que 182 jours', async () => {
    await testRecu('Atelier Fictif', 200);
    await expect(creer('Atelier Fictif')).resolves.toMatchObject({ type: 'premier' });
  });

  it("ne compte pas une invitation jamais utilisée, ni un test d'une autre entreprise", async () => {
    await creer('Autre entreprise');
    await testRecu('Autre entreprise', 10);
    await creer('Atelier Fictif');
    await expect(creer('Atelier Fictif')).resolves.toMatchObject({
      entrepriseNom: 'Atelier Fictif',
    });
  });

  it('renvoie 409 avec le test précédent à la route de création', async () => {
    const dernierId = await testRecu('Atelier Fictif', 10);
    const app = Fastify();
    registerVmaRoutes(app, {
      db: t.app.db,
      connexionDeps: { secretsDir: './secrets/inexistant', realWrites: false },
      vma: { url: SITE, token: JETON },
      fetch: fetchSite,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/i/${mandat.slug}/vma/tests`,
      payload: { entrepriseNom: 'Atelier Fictif', type: 'premier' },
    });
    expect(res.statusCode).toBe(409);
    const corps = JSON.parse(res.body) as { code: string; dernierTest: { id: string } };
    expect(corps.code).toBe('semestre');
    expect(corps.dernierTest.id).toBe(dernierId);

    const confirme = await app.inject({
      method: 'POST',
      url: `/api/i/${mandat.slug}/vma/tests`,
      payload: { entrepriseNom: 'Atelier Fictif', type: 'premier', confirmerSemestre: true },
    });
    expect(confirme.statusCode).toBe(201);
  });
});
