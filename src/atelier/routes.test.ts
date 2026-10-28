import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { entreprises } from '../crm/schema.js';
import { createInstance, setModule } from '../instances/service.js';
import { TAILLE_MAX_ETAT } from './saisie.js';
import { registerAtelierRoutes } from './routes.js';

describe('Atelier stratégique : routes', () => {
  let t: TestApp;
  const app = () => {
    const f = Fastify();
    registerAtelierRoutes(f, { db: t.app.db });
    return f;
  };
  let entrepriseId: string;
  const url = (slug: string, suite = '') => `/api/i/${slug}/ateliers-strategie${suite}`;
  const nombre = async () =>
    Number(
      (await t.owner.pool.query<{ count: string }>('select count(*) from ateliers_strategie'))
        .rows[0]!.count,
    );

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'rt-ok', nom: 'A', type: 'propre' });
    const ok = await setModule(t.owner.db, 'rt-ok', 'atelier', true);
    await createInstance(t.owner.db, { slug: 'rt-sans', nom: 'B', type: 'propre' });
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: ok.id, nom: 'Entreprise Fictive' })
      .returning({ id: entreprises.id });
    entrepriseId = e!.id;
  });
  afterAll(async () => {
    await t.drop();
  });

  it('GET renvoie 403 sans le module atelier', async () => {
    const res = await app().inject({ method: 'GET', url: url('rt-sans') });
    expect(res.statusCode).toBe(403);
  });

  it('instance inconnue : 404', async () => {
    expect((await app().inject({ method: 'GET', url: url('inconnue') })).statusCode).toBe(404);
  });

  it("POST crée puis GET :id renvoie l'état", async () => {
    const crea = await app().inject({
      method: 'POST',
      url: url('rt-ok'),
      payload: { entrepriseId, titre: 'Lancement fictif' },
    });
    expect(crea.statusCode).toBe(200);
    const { id } = crea.json<{ id: string }>();
    const lu = await app().inject({ method: 'GET', url: url('rt-ok', `/${id}`) });
    expect(lu.json()).toMatchObject({ titre: 'Lancement fictif', etat: { v: 1, step: 0 } });
  });

  it('PATCH enregistre le step et le contenu', async () => {
    const { id } = (
      await app().inject({
        method: 'POST',
        url: url('rt-ok'),
        payload: { entrepriseId, titre: 'Patch fictif' },
      })
    ).json<{ id: string }>();
    const res = await app().inject({
      method: 'PATCH',
      url: url('rt-ok', `/${id}`),
      payload: { etat: { v: 1, step: 3, notes: ['a'] } },
    });
    expect(res.json()).toMatchObject({ etape: 4, etapeMax: 4, etat: { notes: ['a'] } });
  });

  it('import accepte { v: 1, steps_state }', async () => {
    const res = await app().inject({
      method: 'POST',
      url: url('rt-ok', '/import'),
      payload: {
        entrepriseId,
        titre: 'Historique fictif',
        sauvegarde: { v: 1, steps_state: { v: 1, step: 4, actions: [{ title: 'a' }] } },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ etape: 5, etat: { actions: [{ title: 'a' }] } });
  });

  it('import refuse un JSON sans steps_state, sans rien créer', async () => {
    const avant = await nombre();
    const res = await app().inject({
      method: 'POST',
      url: url('rt-ok', '/import'),
      payload: { entrepriseId, titre: 'X', sauvegarde: { v: 1 } },
    });
    expect(res.statusCode).toBe(400);
    expect(await nombre()).toBe(avant);
  });

  it('import refuse une mauvaise version, sans rien créer', async () => {
    const avant = await nombre();
    const res = await app().inject({
      method: 'POST',
      url: url('rt-ok', '/import'),
      payload: { entrepriseId, titre: 'X', sauvegarde: { v: 2, steps_state: { v: 1, step: 0 } } },
    });
    expect(res.statusCode).toBe(400);
    expect(await nombre()).toBe(avant);
  });

  it('import refuse un état trop volumineux, sans rien créer', async () => {
    const avant = await nombre();
    const res = await app().inject({
      method: 'POST',
      url: url('rt-ok', '/import'),
      payload: {
        entrepriseId,
        titre: 'X',
        sauvegarde: { v: 1, steps_state: { v: 1, step: 0, gros: 'x'.repeat(TAILLE_MAX_ETAT) } },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(await nombre()).toBe(avant);
  });

  it('entreprise inconnue : 400', async () => {
    const res = await app().inject({
      method: 'POST',
      url: url('rt-ok'),
      payload: { entrepriseId: '00000000-0000-4000-8000-000000000000', titre: 'X' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE supprime, puis 404', async () => {
    const { id } = (
      await app().inject({
        method: 'POST',
        url: url('rt-ok'),
        payload: { entrepriseId, titre: 'À supprimer' },
      })
    ).json<{ id: string }>();
    expect((await app().inject({ method: 'DELETE', url: url('rt-ok', `/${id}`) })).statusCode).toBe(
      200,
    );
    expect((await app().inject({ method: 'GET', url: url('rt-ok', `/${id}`) })).statusCode).toBe(
      404,
    );
  });
});
