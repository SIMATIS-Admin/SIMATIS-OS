import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { DRIVE_SCOPE } from '../connecteurs/google/oauth.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { writeGoogleToken } from '../secrets.js';
import { attentesClaude } from './chat.js';
import type { DriveDeps } from './drive.js';
import { contenuRapportFictif } from './fixtures/rapport-fictif.js';
import { rapportsFinauxPour } from './finaux.js';
import { demanderRapport } from './rapport.js';
import { genererRapportWord } from './rapport-word.js';
import { diagnosticProjets } from './schema.js';
import { createProjet, updateProjet } from './service.js';

const doc = (n: number) => `https://docs.google.com/document/d/doc-${n}/edit`;

// Google fictif : jeton, et export Word (un vrai .docx fictif) sauf pour les Docs « absents ».
const fetchFictif =
  (absents: string[] = []) =>
  (url: string) => {
    if (url === 'https://oauth2.googleapis.com/token')
      return Promise.resolve(new Response(JSON.stringify({ access_token: 'at-fictif' })));
    if (absents.some((a) => url.includes(a)))
      return Promise.resolve(new Response('', { status: 404 }));
    if (url.includes('/export'))
      return Promise.resolve(new Response(Buffer.from(genererRapportWord(contenuRapportFictif))));
    return Promise.resolve(new Response('{}', { status: 404 }));
  };

describe('Rapports finaux relus', () => {
  let t: TestApp;
  let simatis: Instance;
  let secretsDir: string;
  const deps = (absents: string[] = []): DriveDeps => ({
    secretsDir,
    realWrites: false,
    fetch: fetchFictif(absents),
  });

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-finaux',
      nom: 'SIMATIS',
      type: 'propre',
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-finaux-'));
    await writeFile(
      path.join(secretsDir, `${simatis.slug}.env`),
      'GOOGLE_CLIENT_ID=client-fictif\nGOOGLE_CLIENT_SECRET=secret-fictif\n',
    );
    await writeGoogleToken(secretsDir, simatis.slug, {
      refresh_token: 'rt-fictif',
      scope: `gmail.compose ${DRIVE_SCOPE}`,
    });
  });

  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  const projetAvec = async (
    nom: string,
    liens: { lien: string; le: string; version?: number; finale?: boolean }[],
  ) => {
    const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
    await withInstance(t.app.db, simatis.id, (tx) =>
      tx
        .update(diagnosticProjets)
        .set({ rapportLiens: liens })
        .where(eq(diagnosticProjets.id, p.id)),
    );
    return p.id;
  };

  it('renvoie les deux finaux les plus récents, hors projet courant, avec leur texte', async () => {
    await projetAvec('Finaux A', [{ lien: doc(1), le: '2026-10-01T08:00:00.000Z', finale: true }]);
    await projetAvec('Finaux B', [
      { lien: doc(2), le: '2026-10-20T08:00:00.000Z', version: 4, finale: true },
    ]);
    await projetAvec('Finaux C', [
      { lien: doc(3), le: '2026-11-02T08:00:00.000Z', version: 5, finale: true },
    ]);
    const courant = await projetAvec('Finaux courant', [
      { lien: doc(9), le: '2026-11-04T08:00:00.000Z', finale: true },
    ]);
    const finaux = await rapportsFinauxPour(t.app.db, simatis, courant, deps());
    expect(finaux.map((f) => f.version)).toEqual([5, 4]);
    expect(finaux.map((f) => f.nom)).toEqual(['Rapport final 1', 'Rapport final 2']);
    expect(finaux[0]!.texte).toContain('Installer la feuille de route.');
  });

  it('un Doc inaccessible laisse son texte à null sans bloquer l autre', async () => {
    const courant = await projetAvec('Finaux courant 2', []);
    const finaux = await rapportsFinauxPour(t.app.db, simatis, courant, deps(['doc-9']));
    expect(finaux[0]!.texte).toBeNull();
    expect(finaux[1]!.texte).toContain('Atelier Fictif Nord');
  });

  it('sans aucune finale dans l instance, la liste est vide', async () => {
    const autre = await createInstance(t.owner.db, {
      slug: 'simatis-finaux-vide',
      nom: 'SIMATIS vide',
      type: 'propre',
    });
    const p = await createProjet(t.app.db, autre, { nom: 'Seul', activite: 'services' });
    expect(await rapportsFinauxPour(t.app.db, autre, p.id, deps())).toEqual([]);
  });

  it('attentesClaude joint les finaux à une demande de rapport, sauf réglage désactivé', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Finaux demande',
      activite: 'services',
    });
    await updateProjet(t.app.db, simatis, p.id, {
      dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
    });
    await demanderRapport(t.app.db, simatis, p.id);
    const avec = (await attentesClaude(t.app.db, deps())).find((a) => a.id === p.id)!;
    expect(avec.relireFinaux).toBe(true);
    expect(avec.rapportsFinaux).toHaveLength(2);
    const sans = (await attentesClaude(t.app.db)).find((a) => a.id === p.id)!;
    expect(sans.rapportsFinaux).toEqual([]);
    await t.owner.db
      .update((await import('../instances/schema.js')).instances)
      .set({ config: { diagnostic: { relireFinaux: false } } })
      .where(eq((await import('../instances/schema.js')).instances.id, simatis.id));
    const coupe = (await attentesClaude(t.app.db, deps())).find((a) => a.id === p.id)!;
    expect(coupe.relireFinaux).toBe(false);
    expect(coupe.rapportsFinaux).toEqual([]);
  });
});
