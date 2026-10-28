import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { DRIVE_SCOPE } from '../connecteurs/google/oauth.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { writeGoogleToken } from '../secrets.js';
import { demarrerAttente, finirAttente } from './chat.js';
import { exporterRapportDrive, type DriveDeps } from './drive.js';
import { contenuRapportFictif } from './fixtures/rapport-fictif.js';
import { demanderRapport, enregistrerRapport, importerRapport } from './rapport.js';
import { createProjet, listProjets, updateProjet } from './service.js';

type Call = { url: string; method: string };

// Fictive Google: token endpoint, Drive folder creation, Doc upload and Word export.
function fakeGoogle(options: { upload?: number } = {}) {
  const calls: Call[] = [];
  let docs = 0;
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const fetch = (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'at-fictif' });
    if (url.includes('/upload/drive/v3/files')) {
      if (options.upload && options.upload >= 400) {
        return json({ error: { message: 'quota fictif' } }, options.upload);
      }
      docs += 1;
      return json({
        id: `doc-${docs}`,
        name: 'Rapport fictif',
        webViewLink: `https://docs.google.com/document/d/doc-${docs}/edit`,
      });
    }
    if (url.includes('/drive/v3/files?')) {
      return json({ id: 'dossier-1', name: 'Diagnostic fictif' });
    }
    if (url.includes('/export')) {
      return Promise.resolve(new Response(Buffer.from(`PK-export-${url.split('/files/')[1]}`)));
    }
    return json({ error: { message: `route inconnue ${url}` } }, 404);
  };
  return { fetch, calls };
}

describe('Rapport sur Google Docs', () => {
  let t: TestApp;
  let simatis: Instance;
  let simulation: Instance;
  let secretsDir: string;
  let google: ReturnType<typeof fakeGoogle>;
  const deps = (realWrites: boolean): DriveDeps => ({
    secretsDir,
    realWrites,
    fetch: (url, init) => google.fetch(url, init),
  });

  beforeAll(async () => {
    t = await setupTestApp();
    // The first lock (realWrites on the server) is passed per test; this is the instance's one.
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-rapport-drive',
      nom: 'SIMATIS',
      type: 'propre',
      config: { ecrituresReelles: true },
    });
    simulation = await createInstance(t.owner.db, {
      slug: 'simatis-rapport-drive-sim',
      nom: 'SIMATIS simulation',
      type: 'propre',
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-rapport-drive-'));
    for (const slug of [simatis.slug, simulation.slug]) {
      await writeFile(
        path.join(secretsDir, `${slug}.env`),
        'GOOGLE_CLIENT_ID=client-fictif\nGOOGLE_CLIENT_SECRET=secret-fictif\n',
      );
      await writeGoogleToken(secretsDir, slug, {
        refresh_token: 'rt-fictif',
        scope: `gmail.compose ${DRIVE_SCOPE}`,
      });
    }
  });

  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    google = fakeGoogle();
  });

  const relire = async (instance: Instance, id: string) =>
    (await listProjets(t.app.db, instance)).find((p) => p.id === id)!;

  // Project whose report request the runner has taken.
  const enCours = async (instance: Instance, nom: string) => {
    const p = await createProjet(t.app.db, instance, { nom, activite: 'services' });
    await updateProjet(t.app.db, instance, p.id, {
      dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
    });
    await demanderRapport(t.app.db, instance, p.id);
    await demarrerAttente(t.app.db, instance, p.id);
    return p.id;
  };

  const enregistrer = (instance: Instance, id: string, realWrites: boolean) =>
    withInstance(t.app.db, instance.id, (tx) =>
      enregistrerRapport(tx, id, contenuRapportFictif, { instance, deps: deps(realWrites) }),
    );

  it('envoie la version en Google Doc dans un dossier du diagnostic et en garde le lien', async () => {
    const id = await enCours(simatis, 'Rapport Drive A');
    const envoi = await enregistrer(simatis, id, true);
    expect(envoi).toEqual({
      statut: 'ok',
      lien: 'https://docs.google.com/document/d/doc-1/edit',
    });
    const relu = await relire(simatis, id);
    expect(relu.rapportLien).toBe('https://docs.google.com/document/d/doc-1/edit');
    expect(relu.rapportLiens).toEqual([
      expect.objectContaining({
        lien: 'https://docs.google.com/document/d/doc-1/edit',
        version: 1,
      }),
    ]);
    // The Word stays in the project as a fallback.
    expect(relu.aRapport).toBe(true);
    expect(relu.rapportLienStatut).toBe('pret');
    expect(
      google.calls.filter((c) => c.url.includes('googleapis.com/drive/v3/files?')),
    ).toHaveLength(1);
  });

  it('range la version suivante dans le même dossier et garde le lien précédent', async () => {
    const id = await enCours(simatis, 'Rapport Drive B');
    await enregistrer(simatis, id, true);
    await finirAttente(t.app.db, simatis, id);
    await demanderRapport(t.app.db, simatis, id);
    await demarrerAttente(t.app.db, simatis, id);
    await enregistrer(simatis, id, true);
    const relu = await relire(simatis, id);
    expect(relu.rapportLien).toBe('https://docs.google.com/document/d/doc-2/edit');
    expect(relu.rapportLiens.map((l) => l.version)).toEqual([2, 1]);
    // One folder for the diagnostic, two Docs.
    expect(
      google.calls.filter((c) => c.url.includes('googleapis.com/drive/v3/files?')),
    ).toHaveLength(1);
    expect(google.calls.filter((c) => c.url.includes('/upload/drive/v3/files'))).toHaveLength(2);
  });

  it('ne touche pas au Drive en simulation et garde le rapport', async () => {
    const id = await enCours(simulation, 'Rapport Drive C');
    expect(await enregistrer(simulation, id, true)).toEqual({ statut: 'simulation' });
    expect(google.calls.filter((c) => c.url.includes('/drive/'))).toHaveLength(0);
    const relu = await relire(simulation, id);
    expect(relu.rapportLien).toBeNull();
    expect(relu.aRapport).toBe(true);
  });

  it('garde le rapport quand Drive refuse, et le dit', async () => {
    google = fakeGoogle({ upload: 500 });
    const id = await enCours(simatis, 'Rapport Drive D');
    const envoi = await enregistrer(simatis, id, true);
    expect(envoi.statut).toBe('erreur');
    expect(envoi.message).toContain('quota fictif');
    const relu = await relire(simatis, id);
    expect(relu.aRapport).toBe(true);
    expect(relu.rapportLienStatut).toBe('pret');
    expect(relu.rapportLien).toBeNull();
  });

  it('reste muet sur Drive tant que le jeton n a pas le scope Drive', async () => {
    await writeGoogleToken(secretsDir, simatis.slug, {
      refresh_token: 'rt-fictif',
      scope: 'gmail.compose',
    });
    const id = await enCours(simatis, 'Rapport Drive E');
    expect(await enregistrer(simatis, id, true)).toEqual({ statut: 'indisponible' });
    expect(google.calls).toHaveLength(0);
    expect((await relire(simatis, id)).aRapport).toBe(true);
    await writeGoogleToken(secretsDir, simatis.slug, {
      refresh_token: 'rt-fictif',
      scope: `gmail.compose ${DRIVE_SCOPE}`,
    });
  });

  it('exporte en Word le Doc courant, ou celui d une version', async () => {
    const id = await enCours(simatis, 'Rapport Drive F');
    await enregistrer(simatis, id, true);
    await finirAttente(t.app.db, simatis, id);
    await demanderRapport(t.app.db, simatis, id);
    await demarrerAttente(t.app.db, simatis, id);
    await enregistrer(simatis, id, true);

    const courant = await exporterRapportDrive(t.app.db, simatis, id, deps(true));
    expect(courant.contenu.toString()).toContain('doc-2/export');
    expect(courant.nom).toBe('Rapport Diagnostic Endurance - Atelier Fictif Nord - v2.docx');

    const v1 = await exporterRapportDrive(t.app.db, simatis, id, deps(true), 1);
    expect(v1.contenu.toString()).toContain('doc-1/export');
    expect(v1.nom).toContain('- v1.docx');

    await expect(exporterRapportDrive(t.app.db, simatis, id, deps(true), 9)).rejects.toThrow(
      'Aucun Google Doc',
    );
  });

  it('envoie aussi le Word importé de Marc comme nouvelle version', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Rapport Drive G',
      activite: 'services',
    });
    const vue = await importerRapport(
      t.app.db,
      simatis,
      p.id,
      {
        nom: 'Rapport Drive G - v3.docx',
        base64: Buffer.from('PK\u0003\u0004fictif').toString('base64'),
      },
      deps(true),
    );
    expect(vue.rapportLien).toBe('https://docs.google.com/document/d/doc-1/edit');
    expect(vue.rapportLiens).toEqual([expect.objectContaining({ version: 3 })]);
    expect(vue.rapportNom).toBe('Rapport Drive G - v3.docx');
  });
});
