import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { registerVmaRoutes } from './routes.js';
import { RelanceImpossible, relancerInvitation } from './relances.js';
import { vmaTests, type TestVma } from './schema.js';

const JOUR = 24 * 3600 * 1000;
const ecrits: { op: string; data: Record<string, unknown> }[] = [];
registerConnector({
  fournisseur: 'boite-vma-relance',
  sync: () => Promise.resolve({ lus: 0, crees: 0, maj: 0, erreurs: [] }),
  write: (ctx, op) => {
    if (!ctx.reel) return Promise.resolve({ simulation: true });
    ecrits.push(op);
    return Promise.resolve({ simulation: false, id: `m-${ecrits.length}` });
  },
});

registerConnector({
  fournisseur: 'boite-vma-casse',
  sync: () => Promise.resolve({ lus: 0, crees: 0, maj: 0, erreurs: [] }),
  write: () => Promise.reject(new Error('boîte hors ligne')),
});

describe('Relance d’une invitation au test VMA', () => {
  let t: TestApp;
  let reel: Instance;
  let secretsDir: string;
  const verrouOuvert = () => ({ secretsDir, realWrites: true });

  beforeAll(async () => {
    t = await setupTestApp();
    reel = await createInstance(t.owner.db, {
      slug: 'relance-reel',
      nom: 'Mandat',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-relance-'));
    await withInstance(t.app.db, reel.id, (tx) =>
      configureConnexion(tx, { kind: 'messagerie', fournisseur: 'boite-vma-relance' }),
    );
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    ecrits.length = 0;
    await t.owner.pool.query('delete from vma_tests');
  });

  const inviter = async (extra: Partial<typeof vmaTests.$inferInsert> = {}): Promise<TestVma> => {
    const [ligne] = await t.owner.db
      .insert(vmaTests)
      .values({
        instanceId: reel.id,
        entrepriseNom: 'Atelier Fictif',
        contactNom: 'Jeanne',
        contactEmail: 'jeanne@exemple.test',
        type: 'essai',
        invitationId: randomBytes(16).toString('hex'),
        lien: 'https://site.test/test-vma?i=abc',
        expireLe: new Date(Date.now() + 10 * JOUR),
        envoyeeLe: new Date(Date.now() - 8 * JOUR),
        ...extra,
      })
      .returning();
    return ligne!;
  };
  const relire = async (id: string) =>
    (await t.owner.db.select().from(vmaTests).where(eq(vmaTests.id, id)))[0]!;
  const relancer = (
    id: string,
    extra: { tutoiement?: boolean; origine?: 'manuelle' | 'auto' } = {},
  ) =>
    relancerInvitation(t.app.db, reel, verrouOuvert(), {
      testId: id,
      origine: extra.origine ?? 'manuelle',
      ...(extra.tutoiement === undefined ? {} : { tutoiement: extra.tutoiement }),
    });

  it.each([
    ['utilisée', { statut: 'utilisee' as const }],
    ['révoquée', { statut: 'revoquee' as const }],
    ['expirée', { expireLe: new Date(Date.now() - JOUR) }],
    ['sans adresse', { contactEmail: null }],
  ])('refuse une invitation %s', async (_nom, extra) => {
    const test = await inviter(extra);
    await expect(relancer(test.id)).rejects.toBeInstanceOf(RelanceImpossible);
    expect(ecrits).toHaveLength(0);
  });

  it('refuse une invitation inconnue', async () => {
    await expect(relancer('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
      RelanceImpossible,
    );
  });

  it('un envoi réel est compté, avec son origine, et efface l’échec précédent', async () => {
    const test = await inviter({ echecEnvoi: 'boîte hors ligne' });
    const envoi = await relancer(test.id, { origine: 'auto' });
    expect(envoi.statut).toBe('envoye');
    expect(ecrits).toHaveLength(1);
    expect(ecrits[0]?.data.subject).toBe('Rappel : votre test VMA (Atelier Fictif)');
    const apres = await relire(test.id);
    expect(apres.relances).toHaveLength(1);
    expect(apres.relances[0]?.origine).toBe('auto');
    expect(apres.echecEnvoi).toBeNull();
  });

  it('une simulation n’est pas une relance', async () => {
    const test = await inviter();
    const envoi = await relancerInvitation(
      t.app.db,
      reel,
      { secretsDir, realWrites: false },
      { testId: test.id, origine: 'manuelle' },
    );
    expect(envoi.statut).toBe('simule');
    expect((await relire(test.id)).relances).toEqual([]);
  });

  it('un échec est consigné et ne compte pas', async () => {
    const casse = await createInstance(t.owner.db, {
      slug: 'relance-casse',
      nom: 'Mandat cassé',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    await withInstance(t.app.db, casse.id, (tx) =>
      configureConnexion(tx, { kind: 'messagerie', fournisseur: 'boite-vma-casse' }),
    );
    const test = await inviter({ instanceId: casse.id });
    const envoi = await relancerInvitation(t.app.db, casse, verrouOuvert(), {
      testId: test.id,
      origine: 'manuelle',
    });
    expect(envoi).toEqual({ statut: 'echec', raison: 'boîte hors ligne' });
    const apres = await relire(test.id);
    expect(apres.relances).toEqual([]);
    expect(apres.echecEnvoi).toBe('boîte hors ligne');
  });

  it('le tutoiement demandé change le mail et reste sur l’invitation', async () => {
    const test = await inviter();
    await relancer(test.id, { tutoiement: true });
    expect(ecrits[0]?.data.subject).toBe('Rappel : ton test VMA (Atelier Fictif)');
    expect((await relire(test.id)).tutoiement).toBe(true);
  });

  it('un double clic ne produit qu’une relance', async () => {
    const test = await inviter();
    const res = await Promise.allSettled([relancer(test.id), relancer(test.id)]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(ecrits).toHaveLength(1);
    expect((await relire(test.id)).relances).toHaveLength(1);
  });

  describe('route du bouton', () => {
    const appel = async (id: string, corps: unknown = {}) => {
      const app = Fastify();
      registerVmaRoutes(app, {
        db: t.app.db,
        connexionDeps: verrouOuvert(),
        vma: null,
      });
      const rep = await app.inject({
        method: 'POST',
        url: `/api/i/relance-reel/vma/tests/${id}/relancer`,
        payload: corps as object,
      });
      await app.close();
      return rep;
    };

    it('relance une invitation ouverte et rend l’envoi', async () => {
      const test = await inviter();
      const rep = await appel(test.id, { tutoiement: true });
      expect(rep.statusCode).toBe(200);
      expect(rep.json()).toMatchObject({ id: test.id, envoi: { statut: 'envoye' } });
      expect(ecrits).toHaveLength(1);
    });

    it('refuse en 409 une invitation utilisée', async () => {
      const test = await inviter({ statut: 'utilisee' });
      const rep = await appel(test.id);
      expect(rep.statusCode).toBe(409);
      expect(ecrits).toHaveLength(0);
    });

    it('refuse un identifiant invalide', async () => {
      expect((await appel('pas-un-uuid')).statusCode).toBe(400);
    });
  });
});
