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
import { demanderAnnulationRegle, demanderRapport, marquerVersionFinale } from './rapport.js';
import { ajouterChangementsRegles, listerJournalRegles } from './regles.js';
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

  it('l attente des règles joint la finale, le brouillon et les finaux précédents', async () => {
    const p = await projetAvec('Finaux règles', [
      { lien: doc(10), le: '2026-11-03T08:00:00.000Z', version: 5 },
    ]);
    await withInstance(t.app.db, simatis.id, (tx) =>
      tx
        .update(diagnosticProjets)
        .set({
          rapportVersions: [
            { version: 3, le: '2026-11-01T08:00:00.000Z', contenu: contenuRapportFictif },
          ],
        })
        .where(eq(diagnosticProjets.id, p)),
    );
    await marquerVersionFinale(t.app.db, simatis, p, doc(10), true);
    const a = (await attentesClaude(t.app.db, deps())).find((x) => x.id === p)!;
    expect(a.demande).toBe('regles_rapport');
    expect(a.rapportFinalTexte).toContain('Installer la feuille de route.');
    expect(a.rapportBrouillon).toMatchObject({ entreprise: 'Atelier Fictif Nord' });
    expect(a.rapportsFinaux.length).toBeGreaterThan(0);
    expect(a.regleAAnnuler).toBeNull();
  });

  it('l attente d une annulation porte la règle à rétablir', async () => {
    const p = await projetAvec('Finaux annulation', [
      { lien: doc(11), le: '2026-11-03T09:00:00.000Z', version: 6, finale: true },
    ]);
    await withInstance(t.app.db, simatis.id, (tx) =>
      ajouterChangementsRegles(tx, p, 'version finale 6', [
        {
          fiche: 'communes',
          action: 'modifiée',
          libelle: 'Règle fictive',
          avant: 'Avant',
          apres: 'Après',
        },
      ]),
    );
    const [entree] = await listerJournalRegles(t.app.db, simatis, 1);
    await demanderAnnulationRegle(t.app.db, simatis, p, entree!.id);
    const a = (await attentesClaude(t.app.db, deps())).find((x) => x.id === p)!;
    expect(a.regleAAnnuler).toEqual({
      id: entree!.id,
      libelle: 'Règle fictive',
      avant: 'Avant',
      apres: 'Après',
      fiche: 'communes',
    });
    expect(a.rapportFinalTexte).toBeNull();
  });
});
