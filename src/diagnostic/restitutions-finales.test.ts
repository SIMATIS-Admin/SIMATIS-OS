import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { instances, type Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { attentesClaude } from './chat.js';
import { restitutionsFinalesPour } from './restitutions-finales.js';
import { diagnosticProjets, type Projet } from './schema.js';
import { createProjet } from './service.js';

const lien = (mot: string) => `https://claude.ai/artifact/Deck${mot}Fictif`;

describe('Decks de restitution finaux relus', () => {
  let t: TestApp;
  let simatis: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-decks',
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
    restitutionLiens: [
      { lien: lien(`${mot}Ancien`), le: `2026-09-${jour}T12:00:00Z` },
      { lien: lien(mot), le: `2026-10-${jour}T12:00:00Z`, finale: true },
    ],
  });

  it('renvoie les deux plus récents hors projet courant, sans décks non cochés', async () => {
    await projetAvec('Decks A', final('Alpha', '01'));
    await projetAvec('Decks B', final('Bravo', '10'));
    await projetAvec('Decks C', final('Charlie', '20'));
    await projetAvec('Decks non coché', {
      restitutionLiens: [{ lien: lien('Brouillon'), le: '2026-10-30T12:00:00Z' }],
    });
    const courant = await projetAvec('Decks courant', final('Courant', '25'));
    const finaux = await restitutionsFinalesPour(t.app.db, simatis, courant);
    expect(finaux).toEqual([
      { nom: 'Deck final 1', lien: lien('Charlie') },
      { nom: 'Deck final 2', lien: lien('Bravo') },
    ]);
  });

  it('renvoie une liste vide sans deck final', async () => {
    const autre = await createInstance(t.owner.db, {
      slug: 'simatis-decks-vide',
      nom: 'S2',
      type: 'propre',
    });
    const p = await createProjet(t.app.db, autre, { nom: 'Seul', activite: 'services' });
    expect(await restitutionsFinalesPour(t.app.db, autre, p.id)).toEqual([]);
  });

  it('l attente d une production porte les decks finaux, sauf réglage désactivé', async () => {
    const id = await projetAvec('Decks production', {
      demande: 'restitution',
      statutChat: 'attente_claude',
    });
    const avec = (await attentesClaude(t.app.db)).find((a) => a.id === id)!;
    expect(avec.relireRestitutions).toBe(true);
    expect(avec.restitutionsFinales).toHaveLength(2);
    expect(avec.restitutionFinaleLien).toBeNull();
    await t.owner.db
      .update(instances)
      .set({ config: { diagnostic: { relireRestitutions: false } } })
      .where(eq(instances.id, simatis.id));
    const sans = (await attentesClaude(t.app.db)).find((a) => a.id === id)!;
    expect(sans.relireRestitutions).toBe(false);
    expect(sans.restitutionsFinales).toEqual([]);
  });

  it('l attente des règles du deck joint toujours les finaux et le lien du deck final', async () => {
    const id = await projetAvec('Decks règles', {
      ...final('Delta', '28'),
      demande: 'regles_restitution',
      statutChat: 'attente_claude',
    });
    const a = (await attentesClaude(t.app.db)).find((x) => x.id === id)!;
    expect(a.relireRestitutions).toBe(false);
    expect(a.restitutionsFinales).toHaveLength(2);
    expect(a.restitutionFinaleLien).toBe(lien('Delta'));
  });
});
