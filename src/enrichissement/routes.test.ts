import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { insererFiche } from '../../test/fiche-base.js';
import { createInstance } from '../instances/service.js';
import type { ClientIA } from './client.js';
import { attendreLot } from './lot.js';
import { registerEnrichissementRoutes } from './routes.js';

const CFG = { cle: 'cle-fictive-123', modele: 'm', lotMax: 3, budgetJetons: 100000 };
const faux: ClientIA = {
  demander: () =>
    Promise.resolve({
      json: {
        contacts: [
          {
            prenom: 'Claire',
            nom: 'Martin',
            fonction: 'DRH',
            email: 'claire@atelier-fictif.test',
            telephone: null,
            sourceUrl: 'https://atelier-fictif.test/equipe',
            confiance: 'haute',
            modeEmail: 'trouve',
          },
        ],
      },
      jetons: 50,
    }),
};

describe('API de l’enrichissement', () => {
  let t: TestApp;
  let instanceId: string;
  let autreId: string;

  beforeAll(async () => {
    t = await setupTestApp();
    instanceId = (await createInstance(t.owner.db, { slug: 'enr-a', nom: 'A', type: 'mandat' })).id;
    autreId = (await createInstance(t.owner.db, { slug: 'enr-b', nom: 'B', type: 'mandat' })).id;
  });
  afterAll(async () => {
    await t.drop();
  });

  const app = (enrichissement: typeof CFG | null = CFG) => {
    const a = Fastify();
    registerEnrichissementRoutes(a, { db: t.app.db, enrichissement, client: faux });
    return a;
  };
  const fiche = (id: string, entreprise: string) =>
    insererFiche(t.owner.db, {
      instanceId: id,
      zone: 'a_enrichir',
      entreprise,
      nom: '',
      provenance: 'test',
    });
  const base = '/api/i/enr-a/base/enrichissement';

  it('parcours complet : lancer, lire les suggestions, valider, la fiche est remplie', async () => {
    const f = await fiche(instanceId, 'Atelier Fictif');
    const a = app();
    const lancement = await a.inject({
      method: 'POST',
      url: base,
      payload: { type: 'contacts', profil: ['DRH'], maxParEntreprise: 1, ficheIds: [f] },
    });
    expect(lancement.statusCode).toBe(202);
    const tacheId = lancement.json<{ id: string }>().id;
    await attendreLot(tacheId);

    const etat = (await a.inject({ method: 'GET', url: `${base}/${tacheId}` })).json<{
      tache: { etat: string };
      lignes: { etat: string }[];
    }>();
    expect(etat.tache.etat).toBe('terminee');
    expect(etat.lignes[0]?.etat).toBe('terminee');

    const sugg = (await a.inject({ method: 'GET', url: `${base}/${tacheId}/suggestions` })).json<
      { id: string; entreprise: string }[]
    >();
    expect(sugg).toHaveLength(1);
    expect(sugg[0]?.entreprise).toBe('Atelier Fictif');
    expect(JSON.stringify(sugg)).not.toContain(CFG.cle);

    const validation = await a.inject({
      method: 'POST',
      url: `${base}/${tacheId}/valider`,
      payload: { accepter: [sugg[0]?.id], refuser: [] },
    });
    expect(validation.json()).toMatchObject({ appliquees: 1, creees: 0 });
    const { rows } = await t.owner.pool.query('select zone from base_vivante where id = $1', [f]);
    expect(rows[0].zone).toBe('prospectable');
  });

  it('dit si la fonction est disponible et la taille maximale d’un lot', async () => {
    expect((await app().inject({ method: 'GET', url: base })).json()).toMatchObject({
      disponible: true,
      lotMax: 3,
    });
    expect((await app(null).inject({ method: 'GET', url: base })).json()).toMatchObject({
      disponible: false,
    });
  });

  it('sans clé OpenAI, le lancement est refusé en 409', async () => {
    const f = await fiche(instanceId, 'Bureau Fictif');
    const r = await app(null).inject({
      method: 'POST',
      url: base,
      payload: { type: 'contacts', profil: ['DRH'], maxParEntreprise: 1, ficheIds: [f] },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/clé/i);
  });

  it('refuse un lot trop grand et ignore les fiches d’une autre instance', async () => {
    const d = Fastify();
    registerEnrichissementRoutes(d, { db: t.app.db, enrichissement: CFG, client: faux });
    const ids = await Promise.all([1, 2, 3, 4].map((i) => fiche(instanceId, `Société ${i}`)));
    const trop = await d.inject({
      method: 'POST',
      url: base,
      payload: { type: 'contacts', profil: ['DRH'], maxParEntreprise: 1, ficheIds: ids },
    });
    expect(trop.statusCode).toBe(400);
    const etrangere = await fiche(autreId, 'Étrangère Fictive');
    const r = await d.inject({
      method: 'POST',
      url: base,
      payload: { type: 'contacts', profil: ['DRH'], maxParEntreprise: 1, ficheIds: [etrangere] },
    });
    expect(r.statusCode).toBe(400);
  });

  it('corps invalide, identifiant invalide, instance inconnue', async () => {
    const a = app();
    expect(
      (await a.inject({ method: 'POST', url: base, payload: { type: 'x', ficheIds: [] } }))
        .statusCode,
    ).toBe(400);
    expect((await a.inject({ method: 'GET', url: `${base}/pas-un-uuid` })).statusCode).toBe(400);
    expect(
      (await a.inject({ method: 'GET', url: '/api/i/inconnue/base/enrichissement' })).statusCode,
    ).toBe(404);
  });
});
