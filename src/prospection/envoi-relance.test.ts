import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import type { Instance } from '../instances/schema.js';
import { CampagneInvalide } from './campagnes.js';
import { envoyerMailRelance, texteEnHtml } from './envoi-relance.js';
import { ajouterSignature } from './signatures.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 3)]);
const ecrits: { op: string; data: Record<string, unknown> }[] = [];

registerConnector({
  fournisseur: 'boite-envoi-test',
  sync: () => Promise.resolve({ lus: 0, crees: 0, maj: 0, erreurs: [] }),
  write: (ctx, op) => {
    if (!ctx.reel) return Promise.resolve({ simulation: true });
    ecrits.push(op);
    return Promise.resolve({ simulation: false });
  },
});

describe('texteEnHtml', () => {
  it('fait un paragraphe par bloc et échappe le HTML', () => {
    expect(texteEnHtml('Bonjour,\n\nLigne 1\nLigne 2 <b>')).toBe(
      '<p>Bonjour,</p><p>Ligne 1<br>Ligne 2 &lt;b&gt;</p>',
    );
  });
});

describe('Envoi d’un mail de relance', () => {
  let t: TestApp;
  let instance: Instance;
  let secretsDir: string;
  let signatureId: string;

  beforeAll(async () => {
    t = await setupTestApp();
    instance = await createInstance(t.owner.db, {
      slug: 'envoi-a',
      nom: 'A',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-envoi-'));
    await withInstance(t.app.db, instance.id, async (tx) => {
      await configureConnexion(tx, { kind: 'messagerie', fournisseur: 'boite-envoi-test' });
      signatureId = (
        await ajouterSignature(tx, {
          nom: 'Marc',
          typeMime: 'image/png',
          imageBase64: png.toString('base64'),
        })
      ).id;
    });
  });
  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    ecrits.length = 0;
  });

  const mail = {
    to: 'ariane@exemple.test',
    objet: 'Suite à notre échange',
    corps: 'Bonjour,\n\nUn point cette semaine ?',
    signatureId: null as string | null,
    mode: 'envoi' as const,
  };
  const deps = (realWrites = true) => ({ secretsDir, realWrites });

  it('envoie le mail avec la signature en image et dans le fil', async () => {
    const r = await envoyerMailRelance(
      t.app.db,
      instance,
      { ...mail, signatureId, threadId: 'fil-1' },
      deps(),
    );
    expect(r.simulation).toBe(false);
    expect(ecrits).toHaveLength(1);
    expect(ecrits[0]?.op).toBe('message.send');
    const d = ecrits[0]?.data as { html: string; images: unknown[]; threadId: string };
    expect(d.html).toContain('<p>Bonjour,</p>');
    expect(d.html).toContain('cid:signature');
    expect(d.images).toHaveLength(1);
    expect(d.threadId).toBe('fil-1');
  });

  it('crée un brouillon sans signature quand on le demande', async () => {
    await envoyerMailRelance(t.app.db, instance, { ...mail, mode: 'brouillon' }, deps());
    expect(ecrits[0]?.op).toBe('draft.create');
    expect(ecrits[0]?.data.html).not.toContain('cid:signature');
  });

  it('ne part pas tant que les écritures réelles sont fermées', async () => {
    const r = await envoyerMailRelance(t.app.db, instance, mail, deps(false));
    expect(r.simulation).toBe(true);
    expect(ecrits).toHaveLength(0);
  });

  it('refuse une adresse, un objet, un corps ou une signature invalides', async () => {
    const essai = (m: Partial<typeof mail>) =>
      envoyerMailRelance(t.app.db, instance, { ...mail, ...m }, deps());
    await expect(essai({ to: 'pas une adresse' })).rejects.toBeInstanceOf(CampagneInvalide);
    await expect(essai({ objet: '  ' })).rejects.toThrow(/objet/i);
    await expect(essai({ corps: '' })).rejects.toThrow(/vide/i);
    await expect(essai({ signatureId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(
      /signature/i,
    );
    expect(ecrits).toHaveLength(0);
  });
});
