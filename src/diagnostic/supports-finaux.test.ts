import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { instances, type Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { attentesClaude } from './chat.js';
import { diagnosticProjets, type Diapositive, type Projet } from './schema.js';
import { createProjet } from './service.js';
import { supportsFinauxPour } from './supports-finaux.js';
import { demanderSupport } from './support.js';

const diapos = (mot: string): Diapositive[] => [
  { titre: `Titre ${mot}`, texte: `Texte affiché ${mot}`, notes: `Notes d'orateur ${mot}` },
];

describe('Supports finaux relus', () => {
  let t: TestApp;
  let simatis: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-supports',
      nom: 'SIMATIS',
      type: 'propre',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const projetAvec = async (nom: string, maj: Partial<Projet>) => {
    const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
    if (Object.keys(maj).length > 0)
      await withInstance(t.app.db, simatis.id, (tx) =>
        tx.update(diagnosticProjets).set(maj).where(eq(diagnosticProjets.id, p.id)),
      );
    return p.id;
  };
  const final = (mot: string, jour: string): Partial<Projet> => ({
    supportStatut: 'final',
    supportLien: 'https://claude.ai/artifact/AbCdEfGh12',
    supportTexte: diapos(mot),
    supportFinalLe: new Date(`2026-10-${jour}T12:00:00Z`),
  });

  it('renvoie les deux plus récents hors projet courant, avec titres, textes et notes', async () => {
    await projetAvec('Supports A', final('alpha', '01'));
    await projetAvec('Supports B', final('bravo', '10'));
    await projetAvec('Supports C', final('charlie', '20'));
    const courant = await projetAvec('Supports courant', final('courant', '25'));
    const finaux = await supportsFinauxPour(t.app.db, simatis, courant);
    expect(finaux.map((f) => f.nom)).toEqual(['Support final 1', 'Support final 2']);
    expect(finaux[0]!.texte).toContain('Titre charlie');
    expect(finaux[0]!.texte).toContain('Texte affiché charlie');
    expect(finaux[0]!.texte).toContain("Notes d'orateur charlie");
    expect(finaux[1]!.texte).toContain('Titre bravo');
  });

  it('ignore un support non final ou final sans texte', async () => {
    const autre = await createInstance(t.owner.db, {
      slug: 'simatis-supports-vide',
      nom: 'S2',
      type: 'propre',
    });
    const p = await createProjet(t.app.db, autre, { nom: 'Seul', activite: 'services' });
    const cas: [string, Partial<Projet>][] = [
      ['Brouillon', { supportStatut: 'pret', supportTexte: diapos('brouillon') }],
      ['Sans texte', { supportStatut: 'final', supportTexte: null }],
      ['Texte vide', { supportStatut: 'final', supportTexte: [] }],
    ];
    for (const [nom, maj] of cas) {
      const q = await createProjet(t.app.db, autre, { nom, activite: 'services' });
      await withInstance(t.app.db, autre.id, (tx) =>
        tx.update(diagnosticProjets).set(maj).where(eq(diagnosticProjets.id, q.id)),
      );
    }
    expect(await supportsFinauxPour(t.app.db, autre, p.id)).toEqual([]);
  });

  it('l attente d une préparation porte les supports finaux, sauf réglage désactivé', async () => {
    const id = await projetAvec('Supports préparation', {});
    await demanderSupport(t.app.db, simatis, id, 'preparer_support');
    const avec = (await attentesClaude(t.app.db)).find((a) => a.id === id)!;
    expect(avec.relireSupports).toBe(true);
    expect(avec.supportsFinaux).toHaveLength(2);
    expect(avec.supportFinalTexte).toBeNull();
    await t.owner.db
      .update(instances)
      .set({ config: { diagnostic: { relireSupports: false } } })
      .where(eq(instances.id, simatis.id));
    const sans = (await attentesClaude(t.app.db)).find((a) => a.id === id)!;
    expect(sans.relireSupports).toBe(false);
    expect(sans.supportsFinaux).toEqual([]);
  });

  it('l attente des règles du support joint toujours les finaux et le texte du support', async () => {
    const id = await projetAvec('Supports règles', {
      ...final('delta', '28'),
      demande: 'regles_support',
      statutChat: 'attente_claude',
    });
    const a = (await attentesClaude(t.app.db)).find((x) => x.id === id)!;
    expect(a.relireSupports).toBe(false);
    expect(a.supportsFinaux).toHaveLength(2);
    expect(a.supportFinalTexte).toContain('Titre delta');
  });
});
