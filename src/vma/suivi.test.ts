import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { vmaTests } from './schema.js';
import { ReleveVmaImpossible, startReleveVma } from './releve.js';
import { releverSuiviVma } from './suivi.js';

const JETON = 'jeton-releve-'.padEnd(40, 'y');
const hex = () => randomBytes(16).toString('hex');

type Ligne = { invitation: string; mailOuvertLe: string | null; lienOuvertLe: string | null };

// Faux site : la file de suivi que servirait la fonction Cloudflare.
function fauxSite(suivi: unknown[], statut = 200) {
  const acquittes: string[][] = [];
  const fetch = ((url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${JETON}`)
      return Promise.resolve(new Response('{}', { status: 401 }));
    if (u.endsWith('/api/test-vma/suivi') && (init?.method ?? 'GET') === 'GET')
      return Promise.resolve(
        statut === 200 ? Response.json({ suivi }) : new Response('{}', { status: statut }),
      );
    if (u.endsWith('/api/test-vma/suivi') && init?.method === 'POST') {
      const ids = (JSON.parse(init.body as string) as { ids: string[] }).ids;
      acquittes.push(ids);
      return Promise.resolve(Response.json({ effaces: ids.length }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  }) as typeof globalThis.fetch;
  return { fetch, acquittes };
}

describe('Relève du suivi des invitations (mail ouvert, lien ouvert)', () => {
  let t: TestApp;
  let mandat: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    mandat = await createInstance(t.owner.db, {
      slug: 'vma-suivi',
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

  const inviter = async (extra: Partial<typeof vmaTests.$inferInsert> = {}) => {
    const invitationId = hex();
    const [ligne] = await t.owner.db
      .insert(vmaTests)
      .values({
        instanceId: mandat.id,
        entrepriseNom: 'Atelier Fictif',
        type: 'essai',
        invitationId,
        lien: `https://site.test/test-vma?i=${invitationId}`,
        expireLe: new Date(Date.now() + 86_400_000),
        ...extra,
      })
      .returning();
    return ligne!;
  };
  const relever = (site: ReturnType<typeof fauxSite>) =>
    releverSuiviVma(t.app.db, { url: 'https://site.test', token: JETON, fetch: site.fetch });
  const relire = async (id: string) =>
    (await t.owner.db.select().from(vmaTests).where(eq(vmaTests.id, id)))[0]!;
  const ligne = (inv: string, mail: string | null, lien: string | null): Ligne => ({
    invitation: inv,
    mailOuvertLe: mail,
    lienOuvertLe: lien,
  });

  it('enregistre les deux dates et acquitte', async () => {
    const test = await inviter();
    const site = fauxSite([
      ligne(test.invitationId, '2026-11-03T08:00:00.000Z', '2026-11-03T09:00:00.000Z'),
    ]);
    expect(await relever(site)).toEqual({ recus: 1, rattaches: 1 });
    const apres = await relire(test.id);
    expect(apres.mailOuvertLe?.toISOString()).toBe('2026-11-03T08:00:00.000Z');
    expect(apres.lienOuvertLe?.toISOString()).toBe('2026-11-03T09:00:00.000Z');
    expect(site.acquittes).toEqual([[test.invitationId]]);
  });

  it('une date nulle ne touche rien ; la plus ancienne l’emporte', async () => {
    const test = await inviter({
      mailOuvertLe: new Date('2026-11-03T08:00:00.000Z'),
      lienOuvertLe: new Date('2026-11-03T12:00:00.000Z'),
    });
    await relever(
      fauxSite([ligne(test.invitationId, '2026-11-04T08:00:00.000Z', '2026-11-03T10:00:00.000Z')]),
    );
    await relever(fauxSite([ligne(test.invitationId, null, null)]));
    const apres = await relire(test.id);
    expect(apres.mailOuvertLe?.toISOString()).toBe('2026-11-03T08:00:00.000Z');
    expect(apres.lienOuvertLe?.toISOString()).toBe('2026-11-03T10:00:00.000Z');
  });

  it('une invitation inconnue est acquittée sans rien écrire', async () => {
    const inconnue = hex();
    const site = fauxSite([ligne(inconnue, '2026-11-03T08:00:00.000Z', null)]);
    expect(await relever(site)).toEqual({ recus: 1, rattaches: 0 });
    expect(site.acquittes).toEqual([[inconnue]]);
  });

  it('une ligne mal formée est ignorée, les autres passent', async () => {
    const test = await inviter();
    const site = fauxSite([
      { invitation: 'pas-un-id', mailOuvertLe: 'hier' },
      ligne(test.invitationId, '2026-11-03T08:00:00.000Z', null),
    ]);
    expect(await relever(site)).toEqual({ recus: 1, rattaches: 1 });
    expect(site.acquittes).toEqual([[test.invitationId]]);
  });

  it('un site pas encore à jour (404) n’est pas une erreur', async () => {
    const site = fauxSite([], 404);
    expect(await relever(site)).toEqual({ recus: 0, rattaches: 0 });
    expect(site.acquittes).toEqual([]);
  });

  it('une file vide n’acquitte rien', async () => {
    const site = fauxSite([]);
    expect(await relever(site)).toEqual({ recus: 0, rattaches: 0 });
    expect(site.acquittes).toEqual([]);
  });

  it('un refus du site est une erreur', async () => {
    await expect(relever(fauxSite([], 500))).rejects.toBeInstanceOf(ReleveVmaImpossible);
    const mauvaisJeton = fauxSite([]);
    await expect(
      releverSuiviVma(t.app.db, {
        url: 'https://site.test',
        token: 'x',
        fetch: mauvaisJeton.fetch,
      }),
    ).rejects.toBeInstanceOf(ReleveVmaImpossible);
  });

  it('le passage périodique de la relève relève aussi le suivi', async () => {
    const test = await inviter();
    const suivi = fauxSite([ligne(test.invitationId, '2026-11-03T08:00:00.000Z', null)]);
    const fetch = ((url: string | URL, init?: RequestInit) =>
      String(url).endsWith('/en-attente')
        ? Promise.resolve(Response.json({ resultats: [] }))
        : suivi.fetch(url, init)) as typeof globalThis.fetch;
    const arret = startReleveVma(t.app.db, {
      url: 'https://site.test',
      token: JETON,
      fetch,
      tickMs: 3_600_000,
    });
    await expect
      .poll(async () => (await relire(test.id)).mailOuvertLe?.toISOString(), { timeout: 3000 })
      .toBe('2026-11-03T08:00:00.000Z');
    arret();
  });
});
