import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { fabrique } from '../../test/transfert.js';
import { buildApp } from '../app.js';
import { configureConnexion } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { writeGoogleAppSecret } from '../secrets.js';
import { listerRendezVous } from './rdv.js';

// A meeting created in the OS (event id `os:…`): it lives without Google.
describe('Rendez-vous créé dans l’OS', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;
  let seul: Instance;
  let avecGoogle: Instance;
  const maintenant = new Date('2026-10-09T08:00:00Z');
  const deps = () => ({ secretsDir, realWrites: false });

  beforeAll(async () => {
    t = await setupTestApp();
    seul = await createInstance(t.owner.db, { slug: 'rdv-seul', nom: 'Seul', type: 'mandat' });
    avecGoogle = await createInstance(t.owner.db, {
      slug: 'rdv-google',
      nom: 'Google',
      type: 'mandat',
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-rdv-os-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  const creer = (slug: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/i/${slug}/rendez-vous`, payload });
  const valide = {
    titre: 'Point fictif',
    debut: '2026-10-12T08:00:00.000Z',
    dureeMinutes: 45,
    lieu: 'Bureau',
  };

  it('se crée avec un identifiant os: et le statut « RDV »', async () => {
    const r = await creer('rdv-seul', valide);
    expect(r.statusCode).toBe(201);
    const { id } = r.json<{ id: string }>();
    expect(id.startsWith('os:')).toBe(true);
    const ligne = await t.owner.pool.query<{ debut: Date; fin: Date }>(
      'select statut, titre, lieu, debut, fin from rendez_vous where event_id = $1',
      [id],
    );
    expect(ligne.rows[0]).toMatchObject({ statut: 'rdv', titre: 'Point fictif', lieu: 'Bureau' });
    const l = ligne.rows[0];
    expect((l?.fin.getTime() ?? 0) - (l?.debut.getTime() ?? 0)).toBe(45 * 60_000);
    const fiche = await app.inject({
      method: 'GET',
      url: `/api/i/rdv-seul/rendez-vous/${encodeURIComponent(id)}`,
    });
    expect(fiche.statusCode).toBe(200);
    expect(fiche.json()).toMatchObject({ id, titre: 'Point fictif', statut: 'rdv' });
  });

  it('refuse un titre vide, une date invalide ou une durée absurde', async () => {
    expect((await creer('rdv-seul', { ...valide, titre: '  ' })).statusCode).toBe(400);
    expect((await creer('rdv-seul', { ...valide, debut: 'demain' })).statusCode).toBe(400);
    expect((await creer('rdv-seul', { ...valide, dureeMinutes: 0 })).statusCode).toBe(400);
    expect((await creer('rdv-seul', { ...valide, dureeMinutes: 99999 })).statusCode).toBe(400);
  });

  it('s’affiche dans la liste même sans agenda configuré, dans la fenêtre de temps seulement', async () => {
    const dedans = (await creer('rdv-seul', { ...valide, titre: 'Dans la fenêtre' })).json<{
      id: string;
    }>().id;
    await creer('rdv-seul', { ...valide, titre: 'Trop loin', debut: '2026-12-25T08:00:00.000Z' });
    const liste = await listerRendezVous(t.app.db, seul, deps(), maintenant);
    expect(liste.etat).toBe('non_configure');
    expect(liste.rdv.map((r) => r.id)).toContain(dedans);
    expect(liste.rdv.map((r) => r.titre)).not.toContain('Trop loin');
  });

  it('s’affiche aussi quand Google refuse, avec l’erreur à côté', async () => {
    await withInstance(t.app.db, avecGoogle.id, (tx) =>
      configureConnexion(tx, { kind: 'agenda', fournisseur: 'google-agenda', reglages: {} }),
    );
    await creer('rdv-google', { ...valide, titre: 'Malgré Google' });
    const liste = await listerRendezVous(t.app.db, avecGoogle, deps(), maintenant);
    expect(liste.etat).toBe('erreur');
    expect(liste.rdv.map((r) => r.titre)).toContain('Malgré Google');
  });

  it('se mêle aux événements Google, dans l’ordre du temps', async () => {
    await writeGoogleAppSecret(secretsDir, 'GOCSPX-fictif');
    await writeFile(path.join(secretsDir, 'rdv-google.google.json'), '{"refresh_token":"r"}');
    const fetch = (url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('oauth2')
              ? { access_token: 'a' }
              : {
                  items: [
                    {
                      id: 'evt-g',
                      summary: 'Événement Google',
                      start: { dateTime: '2026-10-12T07:00:00Z' },
                      end: { dateTime: '2026-10-12T07:30:00Z' },
                    },
                  ],
                },
          ),
        ),
      );
    const liste = await listerRendezVous(t.app.db, avecGoogle, deps(), maintenant, { fetch });
    expect(liste.etat).toBe('ok');
    const titres = liste.rdv.map((r) => r.titre);
    expect(titres).toEqual(['Événement Google', 'Malgré Google']);
  });

  it('apparaît dans l’historique d’un contact lié dès qu’il a eu lieu', async () => {
    const f = fabrique(t);
    const contact = await f.contact(seul, 'Contact Historique');
    const passe = (
      await creer('rdv-seul', { ...valide, titre: 'Déjà passé', debut: '2020-01-10T08:00:00.000Z' })
    ).json<{ id: string }>().id;
    const futur = (
      await creer('rdv-seul', {
        ...valide,
        titre: 'À venir fictif',
        debut: '2099-01-10T08:00:00.000Z',
      })
    ).json<{ id: string }>().id;
    for (const id of [passe, futur]) {
      const r = await t.owner.pool.query<{ id: string }>(
        'select id from rendez_vous where event_id = $1',
        [id],
      );
      await f.lierRdvContact(seul, r.rows[0]?.id as string, contact);
    }
    const fiche = await app.inject({
      method: 'GET',
      url: `/api/i/rdv-seul/fiches/contact/${contact}`,
    });
    const j = fiche.json<{
      historique: { type: string; titre: string }[];
      rendezVous: { titre: string }[];
    }>();
    expect(j.historique).toContainEqual(
      expect.objectContaining({ type: 'reunion', titre: 'Déjà passé' }),
    );
    expect(j.historique.map((h) => h.titre)).not.toContain('À venir fictif');
    expect(j.rendezVous.map((r) => r.titre)).toEqual(
      expect.arrayContaining(['Déjà passé', 'À venir fictif']),
    );
  });
});
