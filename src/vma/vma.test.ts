import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { InvitationImpossible, creerInvitation, revoquerInvitation } from './invitations.js';
import { releverTestsVma, ReleveVmaImpossible } from './releve.js';

const JETON_INVITATION = 'jeton-invitation-'.padEnd(40, 'x');
const JETON_RELEVE = 'jeton-releve-'.padEnd(40, 'y');
const SITE = 'https://site.test';
const hex = () => randomBytes(16).toString('hex');
const corpsDe = (init?: RequestInit) => (typeof init?.body === 'string' ? init.body : '{}');

// Faux site : les invitations et la file d'attente que servirait la fonction Cloudflare.
function fauxSite(opts: { resultats?: unknown[]; refuserCreation?: boolean } = {}) {
  const invitations = new Map<string, { entreprise: string; type: string; statut: string }>();
  const acquittes: string[][] = [];
  let resultats = opts.resultats ?? [];
  const appels: { methode: string; url: string; auth: string | null }[] = [];
  function repondre(url: string | URL, init?: RequestInit): Response {
    const u = String(url);
    const methode = init?.method ?? 'GET';
    const auth = new Headers(init?.headers).get('authorization');
    appels.push({ methode, url: u, auth });
    const attendu =
      u.includes('/en-attente') || u.includes('/acquitter') ? JETON_RELEVE : JETON_INVITATION;
    if (auth !== `Bearer ${attendu}`) return new Response('{}', { status: 401 });
    if (u.endsWith('/api/test-vma/invitations') && methode === 'POST') {
      if (opts.refuserCreation) return new Response('{}', { status: 500 });
      const body = JSON.parse(corpsDe(init)) as { entreprise: string; type: string };
      const id = hex();
      invitations.set(id, { entreprise: body.entreprise, type: body.type, statut: 'envoyee' });
      return Response.json(
        { id, expireLe: new Date(Date.now() + 86_400_000).toISOString() },
        { status: 201 },
      );
    }
    if (u.includes('/api/test-vma/invitations?id=') && methode === 'DELETE') {
      const id = new URL(u).searchParams.get('id') ?? '';
      const inv = invitations.get(id);
      if (!inv || inv.statut !== 'envoyee') return new Response('{}', { status: 404 });
      inv.statut = 'revoquee';
      return Response.json({ id, statut: 'revoquee' });
    }
    if (u.endsWith('/api/test-vma/en-attente')) return Response.json({ resultats });
    if (u.endsWith('/api/test-vma/acquitter')) {
      const ids = (JSON.parse(corpsDe(init)) as { ids: string[] }).ids;
      acquittes.push(ids);
      resultats = resultats.filter((r) => !ids.includes((r as { id: string }).id));
      return Response.json({ effaces: ids.length });
    }
    return new Response('{}', { status: 404 });
  }
  const fetch = ((url: string | URL, init?: RequestInit) =>
    Promise.resolve(repondre(url, init))) as typeof globalThis.fetch;
  return { fetch, invitations, acquittes, appels, deposer: (r: unknown[]) => (resultats = r) };
}

const resultatPour = (invitation: string, entreprise: string) => ({
  id: hex(),
  invitation,
  type: 'premier',
  recueLe: '2026-10-20T09:00:00.000Z',
  version: '1.0',
  parametres: { gains: { temps: 0.5 }, seuilAmbition: 0.5, seuilTenue: 3 },
  reponses: { entreprise },
  calcul: { vma: 15000, freins: [{ k: 'temps', gainMax: 0.5 }] },
  ecran: {
    entreprise,
    vma: 15000,
    mesurable: true,
    statut: 'prouvée',
    tenue: 'tenue',
    niveau: { cle: 'real', label: 'Réaliste', phrase: 'Phrase fictive.' },
    freins: [],
    textes: {},
  },
});

describe('Test de VMA : invitations et relève', () => {
  let t: TestApp;
  let propre: Instance;
  let mandat: Instance;
  let entrepriseMandat: string;

  beforeAll(async () => {
    t = await setupTestApp();
    propre = await createInstance(t.owner.db, {
      slug: 'vma-propre',
      nom: 'Mon activité',
      type: 'propre',
    });
    mandat = await createInstance(t.owner.db, {
      slug: 'vma-mandat',
      nom: 'Mandat',
      type: 'mandat',
    });
    const [e] = (
      await t.owner.pool.query<{ id: string }>(
        "insert into entreprises (instance_id, nom) values ($1, 'Atelier Fictif') returning id",
        [mandat.id],
      )
    ).rows;
    entrepriseMandat = e!.id;
  });

  afterAll(async () => {
    await t.drop();
  });

  beforeEach(async () => {
    await t.owner.pool.query("delete from sujets where source = 'site' or origine = 'test-vma'");
    await t.owner.pool.query('delete from vma_tests');
  });

  const nombreVma = async () =>
    (await t.owner.pool.query<{ n: string }>('select count(*) as n from vma_tests')).rows[0]?.n;

  const sujetsVma = async () =>
    (
      await t.owner.pool.query<{
        instance_id: string;
        titre: string;
        origine: string;
        source_id: string;
        entreprise_id: string | null;
      }>(
        "select instance_id, titre, origine, source_id, entreprise_id from sujets where origine = 'test-vma' order by titre",
      )
    ).rows;

  const deps = (site: ReturnType<typeof fauxSite>) => ({
    url: SITE,
    token: JETON_INVITATION,
    fetch: site.fetch,
  });

  it("crée une invitation sur le site et la garde dans l'instance avec son lien", async () => {
    const site = fauxSite();
    const test = await creerInvitation(t.app.db, deps(site), {
      instanceId: mandat.id,
      entrepriseId: entrepriseMandat,
      entrepriseNom: 'Atelier Fictif',
      type: 'premier',
    });
    expect(test).toMatchObject({
      instanceId: mandat.id,
      statut: 'envoyee',
      type: 'premier',
      entrepriseNom: 'Atelier Fictif',
    });
    expect(test.lien).toBe(`${SITE}/test-vma?i=${test.invitationId}`);
    expect(site.invitations.get(test.invitationId)).toMatchObject({
      entreprise: 'Atelier Fictif',
      type: 'premier',
    });
  });

  it("ne crée rien dans l'OS si le site refuse l'invitation", async () => {
    await expect(
      creerInvitation(t.app.db, deps(fauxSite({ refuserCreation: true })), {
        instanceId: mandat.id,
        entrepriseNom: 'Atelier Fictif',
        type: 'essai',
      }),
    ).rejects.toThrow(InvitationImpossible);
    const compte = await nombreVma();
    expect(compte).toBe('0');
  });

  it("refuse une entreprise qui n'appartient pas à l'instance", async () => {
    const site = fauxSite();
    await expect(
      creerInvitation(t.app.db, deps(site), {
        instanceId: propre.id,
        entrepriseId: entrepriseMandat,
        entrepriseNom: 'Atelier Fictif',
        type: 'premier',
      }),
    ).rejects.toThrow('introuvable dans cette instance');
    expect(site.appels).toHaveLength(0);
  });

  it('révoque une invitation ouverte, côté site puis dans l’OS', async () => {
    const site = fauxSite();
    const test = await creerInvitation(t.app.db, deps(site), {
      instanceId: mandat.id,
      entrepriseNom: 'Atelier Fictif',
      type: 'premier',
    });
    const revoquee = await revoquerInvitation(t.app.db, deps(site), {
      instanceId: mandat.id,
      testId: test.id,
    });
    expect(revoquee.statut).toBe('revoquee');
    expect(site.invitations.get(test.invitationId)?.statut).toBe('revoquee');
    await expect(
      revoquerInvitation(t.app.db, deps(site), { instanceId: mandat.id, testId: test.id }),
    ).rejects.toThrow('Seule une invitation ouverte');
  });

  it('range le résultat dans l’instance de son invitation, avec un sujet relié à l’entreprise', async () => {
    const site = fauxSite();
    const test = await creerInvitation(t.app.db, deps(site), {
      instanceId: mandat.id,
      entrepriseId: entrepriseMandat,
      entrepriseNom: 'Atelier Fictif',
      type: 'premier',
    });
    const resultat = resultatPour(test.invitationId, 'Atelier Fictif');
    site.deposer([resultat]);

    const r = await releverTestsVma(t.app.db, {
      url: SITE,
      token: JETON_RELEVE,
      fetch: site.fetch,
    });
    expect(r).toEqual({ recus: 1, rattaches: 1, aRattacher: 0, ignores: 0 });

    const [ligne] = (
      await t.owner.pool.query<{ resultat_id: string; calcul: { vma: number } }>(
        'select resultat_id, calcul from vma_tests where id = $1',
        [test.id],
      )
    ).rows;
    expect(ligne?.resultat_id).toBe(resultat.id);
    expect(ligne?.calcul.vma).toBe(15000);

    const sujets = await sujetsVma();
    expect(sujets).toEqual([
      {
        instance_id: mandat.id,
        titre: 'Test de VMA reçu : Atelier Fictif',
        origine: 'test-vma',
        source_id: resultat.id,
        entreprise_id: entrepriseMandat,
      },
    ]);
    expect(site.acquittes).toEqual([[resultat.id]]);
  });

  it('ne range jamais le résultat d’un mandat dans « Mon activité »', async () => {
    const site = fauxSite();
    const test = await creerInvitation(t.app.db, deps(site), {
      instanceId: mandat.id,
      entrepriseNom: 'Atelier Fictif',
      type: 'premier',
    });
    site.deposer([resultatPour(test.invitationId, 'Atelier Fictif')]);
    await releverTestsVma(t.app.db, { url: SITE, token: JETON_RELEVE, fetch: site.fetch });
    expect((await sujetsVma()).map((s) => s.instance_id)).toEqual([mandat.id]);
  });

  it('ne crée rien deux fois quand un résultat est relevé deux fois', async () => {
    const site = fauxSite();
    const test = await creerInvitation(t.app.db, deps(site), {
      instanceId: mandat.id,
      entrepriseNom: 'Atelier Fictif',
      type: 'premier',
    });
    const resultat = resultatPour(test.invitationId, 'Atelier Fictif');
    site.deposer([resultat]);
    await releverTestsVma(t.app.db, { url: SITE, token: JETON_RELEVE, fetch: site.fetch });
    site.deposer([resultat]);
    const second = await releverTestsVma(t.app.db, {
      url: SITE,
      token: JETON_RELEVE,
      fetch: site.fetch,
    });
    expect(second.rattaches).toBe(0);
    expect(await sujetsVma()).toHaveLength(1);
  });

  it('signale un résultat à rattacher quand son invitation est inconnue, sans rien créer d’autre', async () => {
    const site = fauxSite();
    const inconnu = resultatPour(hex(), 'Inconnue');
    site.deposer([inconnu]);
    const r = await releverTestsVma(t.app.db, {
      url: SITE,
      token: JETON_RELEVE,
      fetch: site.fetch,
    });
    expect(r).toMatchObject({ aRattacher: 1, rattaches: 0 });
    const sujets = await sujetsVma();
    expect(sujets).toEqual([
      {
        instance_id: propre.id,
        titre: 'Test de VMA à rattacher',
        origine: 'test-vma',
        source_id: inconnu.id,
        entreprise_id: null,
      },
    ]);
    expect(await nombreVma()).toBe('0');
  });

  it('acquitte un résultat mal formé sans le ranger, pour ne pas bloquer la relève', async () => {
    const site = fauxSite();
    const mauvais = { id: hex(), invitation: hex(), type: 'inconnu' };
    site.deposer([mauvais]);
    const r = await releverTestsVma(t.app.db, {
      url: SITE,
      token: JETON_RELEVE,
      fetch: site.fetch,
    });
    expect(r).toMatchObject({ ignores: 1, rattaches: 0, aRattacher: 0 });
    expect(site.acquittes).toEqual([[mauvais.id]]);
    expect(await sujetsVma()).toHaveLength(0);
  });

  it('refuse la relève si le jeton de relève est mauvais', async () => {
    const site = fauxSite();
    await expect(
      releverTestsVma(t.app.db, {
        url: SITE,
        token: 'mauvais-jeton-'.padEnd(40, 'z'),
        fetch: site.fetch,
      }),
    ).rejects.toThrow(ReleveVmaImpossible);
  });
});
