import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { ecrireArchive, lireTout, texteComplet } from '../connecteurs/hubspot/archive.js';
import { hubspotClient } from '../connecteurs/hubspot/client.js';
import { createInstance } from '../instances/service.js';
import { enrichirActivites } from './archive-hubspot.js';
import { activites } from './schema.js';

const reponse = (corps: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(corps), { status }));

// Un HubSpot fictif : quelques notes et réunions, des mails interdits par le jeton.
const donnees: Record<string, { id: string; properties: Record<string, string> }[]> = {
  contacts: [{ id: 'c1', properties: { firstname: 'Camille', ville_inconnue: 'x' } }],
  companies: [],
  deals: [],
  notes: [{ id: 'n1', properties: { hs_note_body: `<p>${'long '.repeat(800)}</p>` } }],
  calls: [],
  meetings: [
    {
      id: 'm1',
      properties: { hs_meeting_body: '<p>Compte rendu fictif</p>', hs_meeting_location: 'Lyon' },
    },
  ],
  tasks: [],
};
const fauxFetch = (url: string, init: RequestInit) => {
  const u = new URL(url);
  const m = /\/crm\/v3\/properties\/(\w+)/.exec(u.pathname);
  if (m) return reponse({ results: [{ name: 'hs_note_body' }, { name: 'firstname' }] });
  const o = /\/crm\/v3\/objects\/(\w+)$/.exec(u.pathname);
  if (o) {
    if (o[1] === 'emails') return reponse({ message: 'scopes manquants' }, 403);
    return reponse({ results: donnees[o[1] ?? ''] ?? [] });
  }
  if (init.method === 'POST' && u.pathname.includes('/associations/')) {
    return reponse({ results: [{ from: { id: 'n1' }, to: [{ toObjectId: 'c1' }] }] });
  }
  return reponse({}, 404);
};

describe('archive HubSpot', () => {
  it('lit tout, garde les liens et signale les mails non lisibles', async () => {
    const archive = await lireTout(
      hubspotClient('jeton-fictif', { fetch: fauxFetch, retries: 1 }),
      'x',
    );
    expect(archive.objets.contacts).toHaveLength(1);
    expect(archive.objets.notes).toHaveLength(1);
    expect(archive.ignores.emails).toMatch(/scopes manquants/);
    expect(archive.liens.notes?.n1?.contacts).toEqual(['c1']);
    const dossier = await mkdtemp(path.join(tmpdir(), 'archive-'));
    const fichier = await ecrireArchive(archive, dossier);
    const relue = JSON.parse(await readFile(fichier, 'utf8')) as {
      objets: { meetings: unknown[] };
    };
    expect(relue.objets.meetings).toHaveLength(1);
    await rm(dossier, { recursive: true, force: true });
  });

  it('ne coupe plus les notes à 2000 caractères et garde le corps des réunions', () => {
    const note = texteComplet('notes', { hs_note_body: `<p>${'mot '.repeat(1000)}</p>` });
    expect(note?.length).toBeGreaterThan(3500);
    expect(
      texteComplet('meetings', { hs_meeting_body: '<p>Bilan</p>', hs_meeting_location: 'Lyon' }),
    ).toBe('Bilan\nLieu : Lyon');
    expect(texteComplet('calls', {})).toBeNull();
  });
});

describe('enrichirActivites', () => {
  let t: TestApp;
  let dossier: string;
  beforeAll(async () => {
    t = await setupTestApp();
    dossier = await mkdtemp(path.join(tmpdir(), 'enrichir-'));
  });
  afterAll(async () => {
    await rm(dossier, { recursive: true, force: true });
    await t.drop();
  });

  it('complète les textes coupés, jamais un texte plus long, et dit ce qui manque', async () => {
    const instance = await createInstance(t.owner.db, { slug: 'enr', nom: 'E', type: 'propre' });
    const [court, long] = await t.owner.db
      .insert(activites)
      .values([
        { instanceId: instance.id, type: 'note', at: new Date(), resume: 'coupé…' },
        { instanceId: instance.id, type: 'reunion', at: new Date(), resume: 'x'.repeat(500) },
      ])
      .returning({ id: activites.id });
    await writeFile(
      path.join(dossier, 'detachement-hubspot-enr-2026-01-01T00-00-00-000Z.json'),
      JSON.stringify({
        correspondances: {
          activites: [
            { id: court?.id, sourceId: 'n1' },
            { id: long?.id, sourceId: 'm1' },
          ],
        },
      }),
    );
    const archive = {
      slug: 'enr',
      lueLe: '',
      ignores: {},
      liens: {},
      objets: {
        notes: [{ id: 'n1', properties: { hs_note_body: `<p>${'mot '.repeat(1000)}</p>` } }],
        meetings: [{ id: 'm1', properties: { hs_meeting_body: '<p>court</p>' } }],
        calls: [{ id: 'inconnu', properties: { hs_call_body: 'x' } }],
      },
    };
    const simulation = await enrichirActivites(t.owner.db, 'enr', archive, dossier, false);
    expect(simulation).toEqual({
      activitesArchivees: 3,
      retrouvees: 2,
      absentesDeLOs: 1,
      enrichies: 1,
    });
    const avant = await t.owner.pool.query<{ resume: string }>(
      'select resume from activites where id = $1',
      [court?.id],
    );
    expect(avant.rows[0]?.resume).toBe('coupé…');

    await enrichirActivites(t.owner.db, 'enr', archive, dossier, true);
    const apres = await t.owner.pool.query(
      'select id, resume from activites where instance_id = $1',
      [instance.id],
    );
    const parId = new Map(apres.rows.map((r: { id: string; resume: string }) => [r.id, r.resume]));
    expect(parId.get(court?.id ?? '')?.length).toBeGreaterThan(3500);
    expect(parId.get(long?.id ?? '')).toBe('x'.repeat(500));
  });
});
