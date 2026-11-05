import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  DEBUT_MESSAGE_PREPARER_REVUE,
  DEBUT_MESSAGE_REGLES_ANALYSE,
  demanderPreparationRevue,
  demanderCapitalisationAnalyse,
  revueVientDEtreValidee,
} from './analyse.js';
import { ChatIndisponible } from './chat.js';
import { diagnosticProjets } from './schema.js';
import { createProjet, listProjets } from './service.js';

describe('revueVientDEtreValidee', () => {
  it.each([
    ['brouillon', 'validée', true],
    [undefined, 'validée', true],
    [null, 'validée', true],
    ['validée', 'validée', false],
    ['validée', 'brouillon', false],
    [undefined, undefined, false],
    ['brouillon', 'brouillon', false],
  ])('%s → %s : %s', (avant, apres, attendu) => {
    expect(revueVientDEtreValidee(avant, apres)).toBe(attendu);
  });
});

describe('Capitalisation de l analyse', () => {
  let t: TestApp;
  let simatis: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-analyse',
      nom: 'S',
      type: 'propre',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const relire = async (id: string) =>
    (await listProjets(t.app.db, simatis)).find((p) => p.id === id)!;
  const projetAvecRevue = async (nom: string, revue: Record<string, unknown> | null) => {
    const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
    await withInstance(t.app.db, simatis.id, (tx) =>
      tx.update(diagnosticProjets).set({ revue }).where(eq(diagnosticProjets.id, p.id)),
    );
    return p.id;
  };

  it('lance la demande de règles d analyse à l étape 3 sur une revue validée', async () => {
    const id = await projetAvecRevue('Analyse A', { statut: 'validée' });
    await demanderCapitalisationAnalyse(t.app.db, simatis, id);
    const p = await relire(id);
    expect(p.demande).toBe('regles_analyse');
    expect(p.conversation.at(-1)).toMatchObject({
      de: 'pilote',
      etape: 3,
      texte: `${DEBUT_MESSAGE_REGLES_ANALYSE}.`,
    });
  });

  it('refuse sur un brouillon, sans revue, et pendant que Claude répond', async () => {
    for (const revue of [{ statut: 'brouillon' }, null]) {
      const id = await projetAvecRevue('Analyse B', revue);
      await expect(demanderCapitalisationAnalyse(t.app.db, simatis, id)).rejects.toThrow(
        ChatIndisponible,
      );
    }
    const occupe = await projetAvecRevue('Analyse C', { statut: 'validée' });
    await demanderCapitalisationAnalyse(t.app.db, simatis, occupe);
    await expect(demanderCapitalisationAnalyse(t.app.db, simatis, occupe)).rejects.toThrow(
      ChatIndisponible,
    );
  });

  describe('préparation de la revue', () => {
    const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
    const projetAvec = async (nom: string, maj: Partial<typeof diagnosticProjets.$inferInsert>) => {
      const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
      if (Object.keys(maj).length > 0)
        await withInstance(t.app.db, simatis.id, (tx) =>
          tx.update(diagnosticProjets).set(maj).where(eq(diagnosticProjets.id, p.id)),
        );
      return p.id;
    };

    it('part à l étape 3 sur un projet avec résultat, sans revue ou en brouillon', async () => {
      for (const revue of [null, { statut: 'brouillon' }]) {
        const id = await projetAvec('Prépa A', { dims, revue });
        await demanderPreparationRevue(t.app.db, simatis, id);
        const p = await relire(id);
        expect(p.demande).toBe('revue_preparer');
        expect(p.conversation.at(-1)).toMatchObject({
          de: 'pilote',
          etape: 3,
          texte: `${DEBUT_MESSAGE_PREPARER_REVUE}.`,
        });
      }
    });

    it('refuse sans résultat, sur une revue validée, et pendant que Claude répond', async () => {
      const sansResultat = await projetAvec('Prépa B', {});
      await expect(demanderPreparationRevue(t.app.db, simatis, sansResultat)).rejects.toThrow(
        /résultat/,
      );
      const validee = await projetAvec('Prépa C', { dims, revue: { statut: 'validée' } });
      await expect(demanderPreparationRevue(t.app.db, simatis, validee)).rejects.toThrow(
        ChatIndisponible,
      );
      const occupe = await projetAvec('Prépa D', { dims });
      await demanderPreparationRevue(t.app.db, simatis, occupe);
      await expect(demanderPreparationRevue(t.app.db, simatis, occupe)).rejects.toThrow(
        ChatIndisponible,
      );
    });
  });
});
