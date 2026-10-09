import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { configureConnexion } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { getInstanceBySlug } from '../instances/service.js';
import { writeGoogleAppSecret } from '../secrets.js';
import { listerRendezVous } from './rdv.js';

type Row = Record<string, unknown>;

describe('Rendez-vous and Devis', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let secretsDir: string;

  const send = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as object });
    return { status: res.statusCode, body: res.json<Row & Row[]>() };
  };
  const oppOf = async (slug: string) => {
    const { rows } = await t.owner.pool.query<{ id: string; contact_id: string }>(
      "select o.id, o.contact_id from opportunites o join instances i on i.id = o.instance_id where i.slug = $1 and o.clos is null and o.etape in ('detection', 'prospection', 'qualification') and o.contact_id is not null order by o.titre limit 1",
      [slug],
    );
    if (!rows[0]) throw new Error('no open deal');
    return rows[0];
  };

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-conversion-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it('has no quotes outside SIMATIS’s own instance', async () => {
    expect((await send('GET', '/api/i/helioval/devis')).status).toBe(404);
    expect(
      (await send('POST', '/api/i/helioval/devis', { opportuniteId: crypto.randomUUID() })).status,
    ).toBe(404);
  });

  it('prepares a quote without prices, refuses to validate it until every price is set', async () => {
    const opp = await oppOf('simatis');
    const created = await send('POST', '/api/i/simatis/devis', { opportuniteId: opp.id });
    expect(created.status).toBe(200);
    const id = created.body.id as string;
    expect(created.body.lignes).toEqual([
      expect.objectContaining({ prixUnitaire: null }),
      expect.objectContaining({ prixUnitaire: null }),
    ]);

    const tooSoon = await send('POST', `/api/i/simatis/devis/${id}/valider`);
    expect(tooSoon.status).toBe(400);
    expect(tooSoon.body.error).toMatch(/prix/);

    const lignes = (created.body.lignes as Row[]).map((l, k) => ({
      ...l,
      prixUnitaire: k === 0 ? 4500 : null,
    }));
    await send('PATCH', `/api/i/simatis/devis/${id}`, { lignes });
    expect((await send('POST', `/api/i/simatis/devis/${id}/valider`)).status).toBe(400);

    lignes[1] = { ...lignes[1], prixUnitaire: 1500 };
    await send('PATCH', `/api/i/simatis/devis/${id}`, { lignes });
    expect((await send('POST', `/api/i/simatis/devis/${id}/valider`)).status).toBe(200);
    const list = await send('GET', '/api/i/simatis/devis');
    expect(list.body[0]).toMatchObject({ statut: 'valide', total: 6000, prixManquant: false });
    expect((await send('PATCH', `/api/i/simatis/devis/${id}`, { lignes })).status).toBe(400);
  });

  it('sends a quote only once the pilot validates the L2 proposal', async () => {
    const [devis] = (await send('GET', '/api/i/simatis/devis')).body;
    const proposal = await send('POST', `/api/i/simatis/devis/${devis?.id as string}/transmettre`);
    expect(proposal.body).toMatchObject({
      type: 'devis.transmettre',
      niveau: 'L2',
      statut: 'proposee',
    });
    expect((await send('GET', '/api/i/simatis/devis')).body[0]).toMatchObject({ statut: 'valide' });

    const decided = await send(
      'POST',
      `/api/i/simatis/propositions/${proposal.body.id as string}/decision`,
      {
        decision: 'valider',
      },
    );
    expect(decided.body).toMatchObject({ statut: 'appliquee' });
    expect((await send('GET', '/api/i/simatis/devis')).body[0]).toMatchObject({
      statut: 'transmis',
    });
    const { rows } = await t.owner.pool.query<{ etape: string }>(
      'select etape from opportunites where id = (select opportunite_id from devis limit 1)',
    );
    expect(rows[0]?.etape).toBe('proposition');
  });

  it('links agenda meetings to contacts and deals, and turns a compte rendu into a task proposal', async () => {
    const { rows } = await t.owner.pool.query<{ email: string; id: string }>(
      "select c.email, c.id from contacts c join instances i on i.id = c.instance_id join opportunites o on o.contact_id = c.id and o.clos is null where i.slug = 'helioval' limit 1",
    );
    const contact = rows[0];
    if (!contact) throw new Error('no contact');
    const instance = await getInstanceBySlug(t.app.db, 'helioval');
    if (!instance) throw new Error('no instance');
    await withInstance(t.app.db, instance.id, (tx) =>
      configureConnexion(tx, { kind: 'agenda', fournisseur: 'google-agenda', reglages: {} }),
    );
    await writeGoogleAppSecret(secretsDir, 'GOCSPX-fictif');
    await writeFile(path.join(secretsDir, 'helioval.google.json'), '{"refresh_token":"r"}');
    const fetch = (url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('oauth2')
              ? { access_token: 'a' }
              : {
                  items: [
                    {
                      id: 'evt-1',
                      summary: 'Point projet',
                      start: { dateTime: '2026-10-12T08:00:00Z' },
                      end: { dateTime: '2026-10-12T09:00:00Z' },
                      attendees: [
                        { email: 'moi@example.fr', self: true },
                        { email: contact.email.toUpperCase() },
                      ],
                    },
                  ],
                },
          ),
        ),
      );
    const list = await listerRendezVous(
      t.app.db,
      instance,
      { secretsDir, realWrites: false },
      new Date('2026-10-09T08:00:00Z'),
      { fetch },
    );
    expect(list.etat).toBe('ok');
    expect(list.rdv[0]).toMatchObject({
      id: 'evt-1',
      contact: { id: contact.id },
      compteRendu: false,
    });
    expect(list.rdv[0]?.opportunite?.titre).toBeTruthy();

    const prep = await send(
      'GET',
      `/api/i/helioval/opportunites/${list.rdv[0]?.opportunite?.id as string}/preparation`,
    );
    expect(prep.status).toBe(200);
    expect(prep.body).toHaveProperty('aCreuser');

    const cr = await send('POST', '/api/i/helioval/rendez-vous/evt-1/compte-rendu', {
      titre: 'Point projet',
      texte: 'Besoin confirmé, proposition en deux options attendue.',
      contactId: contact.id,
      opportuniteId: list.rdv[0]?.opportunite?.id,
    });
    expect(cr.body).toMatchObject({ type: 'crm.tache', statut: 'proposee' });
    const again = await listerRendezVous(
      t.app.db,
      instance,
      { secretsDir, realWrites: false },
      new Date('2026-10-09T08:00:00Z'),
      { fetch },
    );
    expect(again.rdv[0]?.compteRendu).toBe(true);
    expect(
      (await send('POST', '/api/i/helioval/rendez-vous/evt-1/compte-rendu', { titre: 'x' })).status,
    ).toBe(400);
  });

  it('reports an agenda that is not connected', async () => {
    expect((await send('GET', '/api/i/aquaterra/rendez-vous')).body).toMatchObject({
      etat: 'non_configure',
      rdv: [],
    });
  });
});
