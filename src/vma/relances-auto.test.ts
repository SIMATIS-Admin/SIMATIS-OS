import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  RELANCE_AUTO_JOURS,
  relancerEnAttente,
  startRelancesVma,
  type ResultatRelancesAuto,
} from './relances.js';
import { vmaTests } from './schema.js';

const JOUR = 24 * 3600 * 1000;
const ecrits: { op: string; data: Record<string, unknown> }[] = [];
registerConnector({
  fournisseur: 'boite-vma-auto',
  sync: () => Promise.resolve({ lus: 0, crees: 0, maj: 0, erreurs: [] }),
  write: (ctx, op) => {
    if (!ctx.reel) return Promise.resolve({ simulation: true });
    // Une adresse « casse » simule une messagerie qui refuse ce destinataire.
    if (op.data.to === 'casse@exemple.test') return Promise.reject(new Error('adresse refusée'));
    ecrits.push(op);
    return Promise.resolve({ simulation: false, id: `m-${ecrits.length}` });
  },
});

describe('Relance automatique des invitations au test VMA', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;
  let secretsDir: string;
  const maintenant = new Date('2026-11-10T08:00:00.000Z');
  const il = (jours: number) => new Date(maintenant.getTime() - jours * JOUR);

  beforeAll(async () => {
    t = await setupTestApp();
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-auto-'));
    for (const slug of ['auto-a', 'auto-b']) {
      const inst = await createInstance(t.owner.db, {
        slug,
        nom: slug,
        type: 'mandat',
        config: { ecrituresReelles: true },
      });
      await withInstance(t.app.db, inst.id, (tx) =>
        configureConnexion(tx, { kind: 'messagerie', fournisseur: 'boite-vma-auto' }),
      );
      if (slug === 'auto-a') a = inst;
      else b = inst;
    }
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    ecrits.length = 0;
    await t.owner.pool.query('delete from vma_tests');
  });

  const inviter = async (extra: Partial<typeof vmaTests.$inferInsert> = {}) => {
    const [ligne] = await t.owner.db
      .insert(vmaTests)
      .values({
        instanceId: a.id,
        entrepriseNom: 'Atelier Fictif',
        contactEmail: 'jeanne@exemple.test',
        type: 'essai',
        invitationId: randomBytes(16).toString('hex'),
        lien: 'https://site.test/test-vma?i=abc',
        expireLe: new Date(maintenant.getTime() + 10 * JOUR),
        envoyeeLe: il(RELANCE_AUTO_JOURS),
        ...extra,
      })
      .returning();
    return ligne!;
  };
  const passer = (realWrites = true) =>
    relancerEnAttente(t.app.db, { secretsDir, realWrites }, maintenant);
  const relances = async (id: string) =>
    (await t.owner.db.select().from(vmaTests).where(eq(vmaTests.id, id)))[0]!.relances;

  it('relance à 7 jours pile, pas à 6 jours', async () => {
    const six = await inviter({ envoyeeLe: il(6) });
    const sept = await inviter({ envoyeeLe: il(7) });
    expect(await passer()).toMatchObject({ relancees: 1 });
    expect(await relances(six.id)).toEqual([]);
    expect((await relances(sept.id))[0]?.origine).toBe('auto');
  });

  it('ne relance pas ce qui n’est plus à relancer', async () => {
    await inviter({ relances: [{ le: il(1).toISOString(), origine: 'manuelle' }] });
    await inviter({ expireLe: il(1) });
    await inviter({ statut: 'utilisee' });
    await inviter({ statut: 'revoquee' });
    await inviter({ contactEmail: null });
    await inviter({ envoyeeLe: null });
    expect(await passer()).toMatchObject({ relancees: 0, echecs: 0 });
    expect(ecrits).toHaveLength(0);
  });

  it('un second passage ne relance pas de nouveau', async () => {
    const test = await inviter();
    await passer();
    expect(await passer()).toMatchObject({ relancees: 0 });
    expect(await relances(test.id)).toHaveLength(1);
    expect(ecrits).toHaveLength(1);
  });

  it('une invitation en échec n’arrête pas les suivantes', async () => {
    await inviter({ contactEmail: 'casse@exemple.test' });
    const bonne = await inviter();
    expect(await passer()).toEqual({ relancees: 1, simulees: 0, echecs: 1 });
    expect(await relances(bonne.id)).toHaveLength(1);
  });

  it('parcourt toutes les instances actives', async () => {
    await inviter();
    const autre = await inviter({ instanceId: b.id });
    expect(await passer()).toMatchObject({ relancees: 2 });
    expect(await relances(autre.id)).toHaveLength(1);
  });

  it('en simulation, rien n’est compté', async () => {
    const test = await inviter();
    expect(await passer(false)).toEqual({ relancees: 0, simulees: 1, echecs: 0 });
    expect(await relances(test.id)).toEqual([]);
  });

  describe('déclenchement quotidien', () => {
    const lancer = async (heureUtc: string) => {
      const resultats: ResultatRelancesAuto[] = [];
      const arret = startRelancesVma(t.app.db, {
        ecriture: { secretsDir, realWrites: true },
        tickMs: 20,
        maintenant: () => new Date(`2026-11-10T${heureUtc}:00.000Z`),
        onResult: (r) => resultats.push(r),
      });
      await new Promise((r) => setTimeout(r, 400));
      arret();
      return resultats;
    };

    it('attend 8 h à Paris', async () => {
      await inviter({ envoyeeLe: il(8) });
      expect(await lancer('06:30')).toEqual([]); // 7 h 30 à Paris (UTC+1)
      expect(ecrits).toHaveLength(0);
    });

    it('passe une seule fois par jour une fois 8 h atteinte', async () => {
      await inviter({ envoyeeLe: il(8) });
      const resultats = await lancer('07:30'); // 8 h 30 à Paris
      expect(resultats).toHaveLength(1);
      expect(resultats[0]?.relancees).toBe(1);
    });
  });
});
