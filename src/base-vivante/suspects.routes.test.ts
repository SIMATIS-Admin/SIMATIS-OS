import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { registerBaseVivanteRoutes } from './routes.js';
import { integrerFiches } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';

// Les fiches se créent par integration.ts, seul point d'écriture de la base vivante.
const integrer = (tx: Parameters<typeof integrerFiches>[0], instanceId: string, brutes: Brut[]) =>
  integrerFiches(
    tx,
    instanceId,
    brutes.map((b) => ({
      fiche: normaliserFiche(b).fiche,
      provenance: 'import',
      mandat: null,
      importId: null,
      collecteLe: null,
    })),
  );

describe('GET /base/suspects', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(async () => {
    await t.drop();
  });

  it("renvoie les suspects de l'instance demandée, filtrés par la recherche", async () => {
    const inst = await createInstance(t.owner.db, { slug: 'bv-sus', nom: 'S', type: 'propre' });
    await withInstance(t.owner.db, inst.id, (tx) =>
      integrer(tx, inst.id, [
        { entreprise: 'Fictive', nom: 'Martin', email: 'martin@exemple.test' },
        { entreprise: 'Inventée', nom: 'Durand', email: 'durand@exemple.test' },
      ]),
    );
    const app = Fastify();
    registerBaseVivanteRoutes(app, { db: t.app.db });
    const tous = await app.inject({ method: 'GET', url: '/api/i/bv-sus/base/suspects' });
    expect(tous.statusCode).toBe(200);
    expect(tous.json<{ nom: string }[]>().map((l) => l.nom)).toEqual(['MARTIN', 'DURAND']);
    const filtre = await app.inject({ method: 'GET', url: '/api/i/bv-sus/base/suspects?q=dur' });
    expect(filtre.json<{ nom: string }[]>().map((l) => l.nom)).toEqual(['DURAND']);
    const inconnue = await app.inject({ method: 'GET', url: '/api/i/inconnue/base/suspects' });
    expect(inconnue.statusCode).toBe(404);
  });
});
