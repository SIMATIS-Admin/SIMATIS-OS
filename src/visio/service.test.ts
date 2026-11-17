import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { fabrique } from '../../test/transfert.js';
import { buildApp } from '../app.js';
import { CALENDAR_EVENTS_SCOPE } from '../connecteurs/google/oauth.js';
import { createInstance, setEcrituresReelles } from '../instances/service.js';
import { writeGoogleAppSecret } from '../secrets.js';
import { creerVisio } from './service.js';

describe('Création d’une visio', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;
  let sansGoogle: Awaited<ReturnType<typeof createInstance>>;
  let reel: Awaited<ReturnType<typeof createInstance>>;
  let entreprisePropre: string;
  let entrepriseAutre: string;
  const appels: { url: string; body: string }[] = [];
  let google: 'ok' | 'refus' = 'ok';

  const fetch = (url: string, init: RequestInit) => {
    appels.push({ url, body: typeof init.body === 'string' ? init.body : '' });
    if (url.includes('oauth2')) {
      return Promise.resolve(new Response(JSON.stringify({ access_token: 'a' })));
    }
    if (google === 'refus') return Promise.resolve(new Response('{}', { status: 401 }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'ev-visio',
          htmlLink: 'https://calendar.example/ev-visio',
          hangoutLink: 'https://meet.example/aaa-bbbb-ccc',
        }),
      ),
    );
  };
  const saisie = (entrepriseId: string) => ({
    entrepriseId,
    motif: 'Restitution',
    debut: '2026-10-20T08:00:00.000Z',
    dureeMinutes: 45,
    invites: ['Client@Exemple.test', 'client@exemple.test'],
  });
  const deps = (realWrites: boolean) => ({
    secretsDir,
    realWrites,
    hote: 'Simatis',
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const evenementsCrees = () => appels.filter((a) => a.url.includes('/calendars/primary/events'));

  beforeAll(async () => {
    t = await setupTestApp();
    sansGoogle = await createInstance(t.owner.db, {
      slug: 'visio-seul',
      nom: 'Seul',
      type: 'mandat',
    });
    reel = await createInstance(t.owner.db, { slug: 'visio-reel', nom: 'Réel', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-visio-'));
    await writeGoogleAppSecret(secretsDir, 'GOCSPX-fictif');
    await writeFile(
      path.join(secretsDir, 'visio-reel.google.json'),
      JSON.stringify({ refresh_token: 'r', scope: CALENDAR_EVENTS_SCOPE }),
    );
    // L'instance relue porte le verrou d'écriture activé par l'interrupteur admin.
    reel = await setEcrituresReelles(t.owner.db, 'visio-reel', true);
    const f = fabrique(t);
    entreprisePropre = await f.entreprise(reel, 'Atelier  Fictif');
    entrepriseAutre = await f.entreprise(sansGoogle, 'Autre Fictive');
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir,
      visioNomHote: 'Hôte Fictif',
    });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it('nomme la visio selon la nomenclature et reste en simulation sans verrou', async () => {
    appels.length = 0;
    const r = await creerVisio(t.app.db, reel, saisie(entreprisePropre), deps(false));
    expect(r.titre).toBe('V - Atelier Fictif x Simatis - Restitution');
    expect(r.google).toBe('simulation');
    expect(r.lienVisio).toBeNull();
    expect(evenementsCrees()).toHaveLength(0);
  });

  it('crée l’événement avec lien Meet et invités dédoublonnés en réel', async () => {
    appels.length = 0;
    google = 'ok';
    const r = await creerVisio(t.app.db, reel, saisie(entreprisePropre), deps(true));
    expect(r.google).toBe('ok');
    expect(r.lienVisio).toBe('https://meet.example/aaa-bbbb-ccc');
    const corps = JSON.parse(evenementsCrees()[0]?.body ?? '{}') as { attendees?: unknown };
    expect(corps.attendees).toEqual([{ email: 'client@exemple.test' }]);
    const ligne = await t.owner.pool.query(
      'select participants, lien_visio from rendez_vous where event_id = $1',
      [r.id],
    );
    expect(ligne.rows[0]).toMatchObject({
      participants: ['client@exemple.test'],
      lien_visio: 'https://meet.example/aaa-bbbb-ccc',
    });
  });

  it('garde le rendez-vous quand Google refuse, sans lien', async () => {
    google = 'refus';
    const r = await creerVisio(t.app.db, reel, saisie(entreprisePropre), deps(true));
    google = 'ok';
    expect(r.google).toBe('erreur');
    expect(r.lienVisio).toBeNull();
    const ligne = await t.owner.pool.query('select titre from rendez_vous where event_id = $1', [
      r.id,
    ]);
    expect(ligne.rows).toHaveLength(1);
  });

  it('refuse une entreprise d’une autre instance', async () => {
    await expect(creerVisio(t.app.db, reel, saisie(entrepriseAutre), deps(false))).rejects.toThrow(
      /Entreprise introuvable/,
    );
  });

  it('répond 404 à une entreprise inconnue et 400 à une adresse invalide par l’API', async () => {
    const url = '/api/i/visio-reel/visios';
    const inconnue = await app.inject({
      method: 'POST',
      url,
      payload: { ...saisie('00000000-0000-4000-8000-000000000000') },
    });
    expect(inconnue.statusCode).toBe(404);
    const invalide = await app.inject({
      method: 'POST',
      url,
      payload: { ...saisie(entreprisePropre), invites: ['pas-une-adresse'] },
    });
    expect(invalide.statusCode).toBe(400);
  });

  it('donne le nom d’hôte du déploiement pour l’aperçu du titre', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/visio/hote' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ hote: 'Hôte Fictif' });
  });
});
