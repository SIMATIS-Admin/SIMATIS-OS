import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  echeanceDe,
  releverDemandesSite,
  ReleveImpossible,
  resumeDe,
  type DemandeSite,
} from './releve.js';

const TOKEN = 'jeton-de-test-'.padEnd(40, 'x');

const demande = (extra: Partial<DemandeSite> = {}): DemandeSite => ({
  id: randomUUID(),
  recueLe: '2026-10-12T09:00:00.000Z',
  objet: 'diagnostic',
  nom: 'Jeanne Fictive',
  entreprise: 'Atelier Fictif',
  email: 'jeanne@exemple.fr',
  fonction: 'Gérante',
  effectif: '10 à 49',
  telephone: null,
  profil: 'Sprinteur',
  message: 'Nous vendons sans CRM.',
  ...extra,
});

// A fake website queue: what the Cloudflare function would serve.
function faux(file: unknown[]) {
  const appels: { url: string; auth: string | null; body?: unknown }[] = [];
  let acquittes: string[] = [];
  let ackStatus = 200;
  const fetch = ((url: string | URL, init?: RequestInit) =>
    Promise.resolve(repondre(url, init))) as typeof globalThis.fetch;
  function repondre(url: string | URL, init?: RequestInit): Response {
    const headers = new Headers(init?.headers);
    // releverDemandesSite only ever sends a JSON string body.
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    appels.push({ url: String(url), auth: headers.get('authorization'), body });
    if (headers.get('authorization') !== `Bearer ${TOKEN}`) {
      return new Response('{}', { status: 401 });
    }
    if (String(url).endsWith('/api/contact/en-attente')) {
      return Response.json({ demandes: file });
    }
    if (String(url).endsWith('/api/contact/acquitter')) {
      acquittes = (body as { ids: string[] }).ids;
      return new Response('{}', { status: ackStatus });
    }
    return new Response('{}', { status: 404 });
  }
  return {
    fetch,
    appels,
    acquittes: () => acquittes,
    refuserAck: () => {
      ackStatus = 500;
    },
  };
}

describe('Site web : relevé des demandes de contact', () => {
  let t: TestApp;
  let propre: Instance;
  let mandat: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    propre = await createInstance(t.owner.db, {
      slug: 'site-propre',
      nom: 'Mon activité',
      type: 'propre',
    });
    mandat = await createInstance(t.owner.db, {
      slug: 'site-mandat',
      nom: 'Mandat',
      type: 'mandat',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  beforeEach(async () => {
    await t.owner.pool.query("delete from sujets where source = 'site'");
  });

  const sujetsSite = async () =>
    (
      await t.owner.pool.query<{
        instance_id: string;
        type: string;
        titre: string;
        resume: string;
        origine: string;
        source_id: string;
        echeance: Date;
      }>(
        "select instance_id, type, titre, resume, origine, source_id, echeance from sujets where source = 'site'",
      )
    ).rows;

  it('drops each request in the Inbox of Mon activité, then acknowledges it', async () => {
    const d = demande();
    const site = faux([d]);
    const r = await releverDemandesSite(t.app.db, {
      url: 'https://site.test/',
      token: TOKEN,
      fetch: site.fetch,
    });

    expect(r).toEqual({ recues: 1, creees: 1, ignorees: 0 });
    const [s] = await sujetsSite();
    expect(s).toMatchObject({
      instance_id: propre.id,
      type: 'diagnostic',
      titre: 'Demande de diagnostic — Atelier Fictif (Jeanne Fictive)',
      origine: 'site',
      source_id: d.id,
    });
    expect(s?.resume).toContain('Email : jeanne@exemple.fr');
    expect(s?.resume).toContain('Profil pressenti par le visiteur : Sprinteur');
    expect(site.acquittes()).toEqual([d.id]);
    expect(site.appels.every((a) => a.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(site.appels[0]?.url).toBe('https://site.test/api/contact/en-attente');
  });

  it('never goes to a mandate, and a meeting request becomes a mail to answer', async () => {
    const site = faux([demande({ objet: 'echange' })]);
    await releverDemandesSite(t.app.db, {
      url: 'https://site.test',
      token: TOKEN,
      fetch: site.fetch,
    });
    const lignes = await sujetsSite();
    expect(lignes.map((l) => l.instance_id)).toEqual([propre.id]);
    expect(lignes.map((l) => l.instance_id)).not.toContain(mandat.id);
    expect(lignes[0]?.type).toBe('mail_a_repondre');
  });

  it('a white paper request from the blog pop-up lands in the Inbox as a mail to answer', async () => {
    const d = demande({ objet: 'livre-blanc' });
    const site = faux([d]);
    const r = await releverDemandesSite(t.app.db, {
      url: 'https://site.test',
      token: TOKEN,
      fetch: site.fetch,
    });
    expect(r).toEqual({ recues: 1, creees: 1, ignorees: 0 });
    const [s] = await sujetsSite();
    expect(s).toMatchObject({
      type: 'mail_a_repondre',
      titre: 'Demande du livre blanc — Atelier Fictif (Jeanne Fictive)',
    });
  });

  it('keeps one subject when the same request is delivered twice', async () => {
    const d = demande();
    await releverDemandesSite(t.app.db, {
      url: 'https://site.test',
      token: TOKEN,
      fetch: faux([d]).fetch,
    });
    const again = await releverDemandesSite(t.app.db, {
      url: 'https://site.test',
      token: TOKEN,
      fetch: faux([d]).fetch,
    });
    expect(again.creees).toBe(0);
    expect(await sujetsSite()).toHaveLength(1);
  });

  it('acknowledges a malformed request without depositing it', async () => {
    const bad = { id: randomUUID(), objet: 'diagnostic', nom: 'Sans email' };
    const site = faux([bad]);
    const r = await releverDemandesSite(t.app.db, {
      url: 'https://site.test',
      token: TOKEN,
      fetch: site.fetch,
    });
    expect(r).toEqual({ recues: 1, creees: 0, ignorees: 1 });
    expect(await sujetsSite()).toHaveLength(0);
    expect(site.acquittes()).toEqual([bad.id]);
  });

  it('does nothing and skips the acknowledgement when the queue is empty', async () => {
    const site = faux([]);
    const r = await releverDemandesSite(t.app.db, {
      url: 'https://site.test',
      token: TOKEN,
      fetch: site.fetch,
    });
    expect(r).toEqual({ recues: 0, creees: 0, ignorees: 0 });
    expect(site.appels).toHaveLength(1);
  });

  it('fails on a refused token, and keeps the subject when the acknowledgement fails', async () => {
    await expect(
      releverDemandesSite(t.app.db, {
        url: 'https://site.test',
        token: 'faux',
        fetch: faux([demande()]).fetch,
      }),
    ).rejects.toBeInstanceOf(ReleveImpossible);

    const site = faux([demande()]);
    site.refuserAck();
    await expect(
      releverDemandesSite(t.app.db, { url: 'https://site.test', token: TOKEN, fetch: site.fetch }),
    ).rejects.toThrow(/acquittement/);
    // Committed before the acknowledgement: the next pass re-delivers it and the key dedupes it.
    expect(await sujetsSite()).toHaveLength(1);
  });
});

describe('Site web : mise en forme', () => {
  it('sets the deadline two business days later, skipping the weekend', () => {
    // Friday 12:00 UTC → Tuesday 12:00 UTC.
    expect(echeanceDe(new Date('2026-10-16T12:00:00Z')).toISOString()).toBe(
      '2026-10-20T12:00:00.000Z',
    );
    // Monday → Wednesday.
    expect(echeanceDe(new Date('2026-10-12T12:00:00Z')).toISOString()).toBe(
      '2026-10-14T12:00:00.000Z',
    );
  });

  it('summarises only what the visitor filled in', () => {
    const r = resumeDe(
      demande({ fonction: null, telephone: null, profil: null, message: null, effectif: null }),
    );
    expect(r).toBe('Contact : Jeanne Fictive\nEmail : jeanne@exemple.fr');
  });
});
