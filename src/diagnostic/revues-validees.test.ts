import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { attentesClaude } from './chat.js';
import { resumeRevue, revuesValideesPour } from './revues-validees.js';
import { diagnosticProjets } from './schema.js';
import { createProjet } from './service.js';

const revueFictive = (mot: string, statut = 'validée', savedAt = '2026-10-10T08:00:00.000Z') => ({
  statut,
  savedAt,
  preconisations: {
    p1: {
      titre: `Préconisation ${mot}`,
      texte: `Texte proposé ${mot}`,
      choix: 'remplacer',
      detail: `Texte du pilote ${mot}`,
    },
    p2: { titre: 'Autre préconisation', texte: 'Autre proposition', choix: 'retirer', detail: '' },
  },
  planAction: {
    court: {
      blocs: {
        b1: { bloc: 'Cible', texte: `Action proposée ${mot}`, choix: 'garder', detail: '' },
      },
      libre: `Commentaire libre court ${mot}`,
    },
    moyen: { blocs: {}, libre: '' },
  },
  conclusion: { proposition: 'Conclusion proposée', choix: 'garder', detail: '' },
  indicateurs: `Indicateurs ${mot}`,
  nonFait: '',
});

describe('resumeRevue', () => {
  it('rend propositions, choix et textes du pilote, plan d action et champs libres', () => {
    const r = resumeRevue(revueFictive('alpha'));
    expect(r).toContain('Préconisation alpha');
    expect(r).toContain('proposé : Texte proposé alpha');
    expect(r).toContain('choix : remplacer');
    expect(r).toContain('texte du pilote : Texte du pilote alpha');
    expect(r).toContain('choix : retirer');
    expect(r).toContain('Court terme');
    expect(r).toContain('Cible');
    expect(r).toContain('Commentaire libre court alpha');
    expect(r).toContain('Indicateurs alpha');
    expect(r).toContain('Conclusion proposée');
  });

  it('une revue vide ou aux champs absents ne produit ni null ni undefined', () => {
    for (const revue of [
      {},
      { preconisations: { p1: {} }, planAction: { court: { blocs: { b: 3 } } } },
    ]) {
      const r = resumeRevue(revue);
      expect(r).not.toMatch(/\bnull\b|undefined/);
    }
    expect(resumeRevue({})).toContain('(aucune préconisation)');
  });

  it('un choix absent est dit « non précisé » et le texte est tronqué à 30 000 caractères', () => {
    expect(resumeRevue({ preconisations: { p1: { titre: 'T', texte: 'X' } } })).toContain(
      'choix : non précisé',
    );
    const grosse = { preconisations: { p1: { titre: 'T', texte: 'x'.repeat(40_000) } } };
    expect(resumeRevue(grosse).length).toBeLessThanOrEqual(30_000);
  });
});

describe('Revues validées relues', () => {
  let t: TestApp;
  let simatis: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-revues',
      nom: 'S',
      type: 'propre',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const projetAvec = async (nom: string, maj: Partial<typeof diagnosticProjets.$inferInsert>) => {
    const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
    if (Object.keys(maj).length > 0)
      await withInstance(t.app.db, simatis.id, (tx) =>
        tx.update(diagnosticProjets).set(maj).where(eq(diagnosticProjets.id, p.id)),
      );
    return p.id;
  };

  it('renvoie les deux plus récentes validées, hors projet courant', async () => {
    await projetAvec('Revues A', {
      revue: revueFictive('a', 'validée', '2026-10-01T08:00:00.000Z'),
    });
    await projetAvec('Revues B', {
      revue: revueFictive('b', 'validée', '2026-10-10T08:00:00.000Z'),
    });
    await projetAvec('Revues C', {
      revue: revueFictive('c', 'validée', '2026-10-20T08:00:00.000Z'),
    });
    await projetAvec('Revues brouillon', {
      revue: revueFictive('d', 'brouillon', '2026-10-30T08:00:00.000Z'),
    });
    await projetAvec('Revues absente', {});
    const courant = await projetAvec('Revues courant', {
      revue: revueFictive('e', 'validée', '2026-10-25T08:00:00.000Z'),
    });
    const revues = await revuesValideesPour(t.app.db, simatis, courant);
    expect(revues.map((r) => r.nom)).toEqual(['Revue validée 1', 'Revue validée 2']);
    expect(revues[0]!.texte).toContain('Préconisation c');
    expect(revues[1]!.texte).toContain('Préconisation b');
  });

  it('l attente d une demande regles_analyse porte la revue du projet et les précédentes, pas une autre demande', async () => {
    const id = await projetAvec('Revues règles', {
      revue: revueFictive('z', 'validée', '2026-11-01T08:00:00.000Z'),
      demande: 'regles_analyse',
      statutChat: 'attente_claude',
    });
    const a = (await attentesClaude(t.app.db)).find((x) => x.id === id)!;
    expect(a.revueValideeTexte).toContain('Préconisation z');
    expect(a.revuesValidees).toHaveLength(2);
    const autre = await projetAvec('Revues autre', {
      revue: revueFictive('y'),
      demande: 'rapport',
      statutChat: 'attente_claude',
    });
    const b = (await attentesClaude(t.app.db)).find((x) => x.id === autre)!;
    expect(b.revueValideeTexte).toBeNull();
    expect(b.revuesValidees).toEqual([]);
  });

  it('l attente d une demande revue_preparer porte la revue en cours et les revues validées', async () => {
    const id = await projetAvec('Revues préparation', {
      revue: {
        statut: 'brouillon',
        preconisations: { r1: { titre: 'En cours fictive', choix: 'garder' } },
      },
      demande: 'revue_preparer',
      statutChat: 'attente_claude',
    });
    const a = (await attentesClaude(t.app.db)).find((x) => x.id === id)!;
    expect(a.revueEnCoursTexte).toContain('En cours fictive');
    expect(a.revuesValidees.length).toBeGreaterThan(0);
    const sansRevue = await projetAvec('Revues préparation vide', {
      demande: 'revue_preparer',
      statutChat: 'attente_claude',
    });
    const b = (await attentesClaude(t.app.db)).find((x) => x.id === sansRevue)!;
    expect(b.revueEnCoursTexte).toBeNull();
  });

  it('une autre demande ne porte pas la revue en cours', async () => {
    const id = await projetAvec('Revues autre demande', {
      revue: { statut: 'brouillon' },
      demande: 'rapport',
      statutChat: 'attente_claude',
    });
    const a = (await attentesClaude(t.app.db)).find((x) => x.id === id)!;
    expect(a.revueEnCoursTexte).toBeNull();
  });
});
