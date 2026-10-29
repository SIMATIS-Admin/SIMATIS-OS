import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { entreprises } from '../crm/schema.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { toolsFor } from '../mcp/tools.js';
import { createProjet, updateProjet } from './service.js';

describe('Capitalisation de la restitution : API', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let dossier: string;
  let simatis: Instance;
  let projetId: string;
  let rdvId: string;
  const base = '/api/i/simatis-capi-api/diagnostic/projets';

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-capi-api',
      nom: 'SIMATIS',
      type: 'propre',
    });
    await createInstance(t.owner.db, { slug: 'autre-capi-api', nom: 'Autre', type: 'propre' });
    dossier = await mkdtemp(path.join(tmpdir(), 'capi-api-'));
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir: dossier,
      realWrites: false,
    });
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: simatis.id, nom: 'Entreprise Fictive Api' })
      .returning({ id: entreprises.id });
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Projet Fictif Api',
      activite: 'services',
      entrepriseId: e!.id,
    });
    await updateProjet(t.app.db, simatis, p.id, { etape: 5 });
    projetId = p.id;
    const { rows } = await t.owner.pool.query<{ id: string }>(
      `insert into rendez_vous (instance_id, event_id, titre, debut, statut, compte_rendu, compte_rendu_at)
       values ($1, 'api-1', 'Restitution fictive', now(), 'rdv', 'Compte rendu fictif', now()) returning id`,
      [simatis.id],
    );
    rdvId = rows[0]!.id;
    await t.owner.pool.query(
      'insert into rdv_entreprises (instance_id, rendez_vous_id, entreprise_id) values ($1, $2, $3)',
      [simatis.id, rdvId, e!.id],
    );
  });
  afterAll(async () => {
    await app.close();
    await rm(dossier, { recursive: true, force: true });
    await t.drop();
  });

  it('liste les rendez-vous capitalisables du projet', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `${base}/${projetId}/capitalisation/rendez-vous`,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ id: string; titre: string }[]>()).toEqual([
      expect.objectContaining({ id: rdvId, titre: 'Restitution fictive' }),
    ]);
  });

  it('ne montre pas le projet à une autre instance', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/i/autre-capi-api/diagnostic/projets/${projetId}/capitalisation/rendez-vous`,
    });
    expect(r.statusCode).toBe(404);
  });

  it('refuse un identifiant invalide (400) et enregistrer sans proposition (409)', async () => {
    const mauvais = await app.inject({
      method: 'POST',
      url: `${base}/pas-un-uuid/capitalisation/proposer`,
      payload: { rdvId },
    });
    expect(mauvais.statusCode).toBe(400);
    const sansRdv = await app.inject({
      method: 'POST',
      url: `${base}/${projetId}/capitalisation/proposer`,
      payload: {},
    });
    expect(sansRdv.statusCode).toBe(400);
    const tropTot = await app.inject({
      method: 'POST',
      url: `${base}/${projetId}/capitalisation/enregistrer`,
      payload: {},
    });
    expect(tropTot.statusCode).toBe(409);
  });

  it('lance la proposition, puis refuse un second lancement avant la réponse', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `${base}/${projetId}/capitalisation/proposer`,
      payload: { rdvId },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ demande: string; capitalisationStatut: string }>()).toEqual(
      expect.objectContaining({
        demande: 'capitalisation_proposer',
        capitalisationStatut: 'en_cours',
      }),
    );
    const encore = await app.inject({
      method: 'POST',
      url: `${base}/${projetId}/capitalisation/proposer`,
      payload: { rdvId },
    });
    expect(encore.statusCode).toBe(409);
  });

  it('expose l’outil enregistrer_capitalisation à Claude', () => {
    expect(toolsFor('instance').map((x) => x.name)).toContain('enregistrer_capitalisation');
  });
});
