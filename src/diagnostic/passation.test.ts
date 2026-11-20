import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  PassationImpossible,
  preparerPassation,
  releverPassations,
  trancheEffectif,
  versReponsesEntretien,
} from './passation.js';
import { createProjet, listProjets } from './service.js';

// Grille fictive : la passation du site porte plus de questions que la grille (les autres sont gardées à part).
const grilleFictive = {
  seuil: 6,
  questions: [
    { section: 'R1', numero: 1, libelle: 'Q1', dimension: 'outils', poids: 2 },
    { section: 'R1', numero: 2, libelle: 'Q2', dimension: 'outils', poids: 1 },
    { section: 'R2', numero: 1, libelle: 'Q3', dimension: 'strategie', poids: 1 },
    { section: 'R3', numero: 1, libelle: 'Q4', dimension: 'polyvalence', poids: 1 },
  ],
};
const grille = grilleFictive as unknown as Parameters<typeof versReponsesEntretien>[1];
const reponsesSite = {
  'R1#1': 'A',
  'R1#2': 'E',
  'R2#1': 'B',
  'R3#1': 'C',
  'R9#9': 'D', // hors grille
} as const;

const jsonRes = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });

describe('Passation : correspondance et tranches', () => {
  it('garde les questions de la grille et transforme E en N/A', () => {
    expect(versReponsesEntretien({ ...reponsesSite }, grille)).toEqual([
      { section: 'R1', numero: 1, reponse: 'A' },
      { section: 'R1', numero: 2, reponse: 'N/A' },
      { section: 'R2', numero: 1, reponse: 'B' },
      { section: 'R3', numero: 1, reponse: 'C' },
    ]);
  });

  it('range un effectif dans les tranches du questionnaire', () => {
    expect([5, 9, 10, 50, 51, 250, 251, 5000, 5001].map(trancheEffectif)).toEqual([
      'moins de 10',
      'moins de 10',
      'de 10 à 50',
      'de 10 à 50',
      'de 50 à 250',
      'de 50 à 250',
      'de 250 à 5000',
      'de 250 à 5000',
      'Plus de 5000',
    ]);
    expect(trancheEffectif(null)).toBe('');
  });
});

describe('Passation : préparation sur le site', () => {
  const projet = {
    id: '11111111-2222-3333-4444-555555555555',
    entreprise: 'Entreprise Fictive',
    interlocuteur: 'Prénom Nom',
    activite: 'services',
    taille: 'de 10 à 50',
    rdv: '26 novembre',
    contexte: 'Contexte fictif',
  };

  it('envoie la fiche avec le jeton OS et rend le lien de la console', async () => {
    let vu: { url: string; init?: RequestInit } | undefined;
    const fetchFictif = ((url: string, init?: RequestInit) => {
      vu = { url, ...(init ? { init } : {}) };
      return Promise.resolve(
        jsonRes(
          {
            lien: 'https://site.test/diagnostic-endurance?t=abc&d=x',
            expireLe: '2026-11-21T00:00:00.000Z',
          },
          201,
        ),
      );
    }) as unknown as typeof fetch;
    const r = await preparerPassation(
      { url: 'https://site.test/', token: 'j'.repeat(32), fetch: fetchFictif },
      projet,
    );
    expect(r.lien).toBe('https://site.test/diagnostic-endurance?t=abc&d=x');
    expect(vu?.url).toBe('https://site.test/api/diagnostic/preparer');
    expect((vu?.init?.headers as Record<string, string>).authorization).toBe(
      `Bearer ${'j'.repeat(32)}`,
    );
    expect(JSON.parse(vu?.init?.body as string)).toMatchObject({
      projetId: projet.id,
      entreprise: 'Entreprise Fictive',
      taille: 'de 10 à 50',
    });
  });

  it('refuse clairement quand le site refuse', async () => {
    const fetchFictif = (() =>
      Promise.resolve(jsonRes({ erreur: 'no' }, 401))) as unknown as typeof fetch;
    await expect(
      preparerPassation(
        { url: 'https://site.test', token: 'j'.repeat(32), fetch: fetchFictif },
        projet,
      ),
    ).rejects.toBeInstanceOf(PassationImpossible);
  });
});

describe('Passation : relève par l’OS', () => {
  let t: TestApp;
  let simatis: Instance;
  let dossier: string;
  let grilleAvant: string | undefined;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-passation',
      nom: 'SIMATIS',
      type: 'propre',
    });
    dossier = await mkdtemp(path.join(tmpdir(), 'passation-'));
    const chemin = path.join(dossier, 'grille.json');
    await writeFile(chemin, JSON.stringify(grilleFictive));
    grilleAvant = process.env.DIAGNOSTIC_GRILLE;
    process.env.DIAGNOSTIC_GRILLE = chemin;
  });
  afterAll(async () => {
    if (grilleAvant === undefined) delete process.env.DIAGNOSTIC_GRILLE;
    else process.env.DIAGNOSTIC_GRILLE = grilleAvant;
    await rm(dossier, { recursive: true, force: true });
    await t.drop();
  });

  const relire = async (id: string) =>
    (await listProjets(t.app.db, simatis)).find((p) => p.id === id)!;

  // Site fictif : un diagnostic terminé en attente, et l'acquittement enregistré.
  const siteAvec = (diagnostics: unknown[]) => {
    const acquittes: unknown[] = [];
    const fetchFictif = ((url: string, init?: RequestInit) => {
      if (url.endsWith('/api/diagnostic/en-attente'))
        return Promise.resolve(jsonRes({ diagnostics }));
      if (url.endsWith('/api/diagnostic/acquitter')) {
        acquittes.push(JSON.parse(init?.body as string));
        return Promise.resolve(jsonRes({ acquittes: 1 }));
      }
      return Promise.resolve(jsonRes({}, 404));
    }) as unknown as typeof fetch;
    return {
      acquittes,
      deps: { url: 'https://site.test', token: 'p'.repeat(32), fetch: fetchFictif },
    };
  };
  const diag = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    reponses: { ...reponsesSite },
    commentaires: { 'R1#1': 'Dit à l’oral', 'R9#9': 'Hors grille' },
    tempsMs: 4_980_000,
    termineLe: '2026-11-26T15:30:00.000Z',
    ...extra,
  });

  it('enregistre les réponses de la grille, calcule les dimensions et acquitte avec le profil', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Passation Fictive A',
      activite: 'services',
    });
    const { acquittes, deps } = siteAvec([diag(p.id)]);
    const r = await releverPassations(t.app.db, deps);
    expect(r).toMatchObject({ recus: 1, enregistres: 1, inconnus: 0 });
    const vu = await relire(p.id);
    expect(vu.reponsesEntretien).toHaveLength(4);
    expect(vu.reponsesEntretien.find((x) => x.section === 'R1' && x.numero === 2)?.reponse).toBe(
      'N/A',
    );
    expect(vu.dims).toEqual({ outils: 10, strategie: 7, polyvalence: 4 });
    // Les 5 réponses, dont celle hors grille, et les commentaires sont gardés tels quels.
    expect(vu.passation).toMatchObject({
      tempsMs: 4_980_000,
      reponses: { 'R9#9': 'D' },
      commentaires: { 'R9#9': 'Hors grille' },
    });
    expect(acquittes).toHaveLength(1);
    expect((acquittes[0] as { items: { id: string; profil: string }[] }).items[0]).toMatchObject({
      id: p.id,
      profil: 'Marathonien',
    });
  });

  it('une seconde relève du même diagnostic ne réécrit rien', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Passation Fictive B',
      activite: 'services',
    });
    await releverPassations(t.app.db, siteAvec([diag(p.id)]).deps);
    const avant = await relire(p.id);
    const r = await releverPassations(t.app.db, siteAvec([diag(p.id)]).deps);
    expect(r.enregistres).toBe(0);
    expect((await relire(p.id)).updatedAt).toEqual(avant.updatedAt);
  });

  it('crée le projet d’un diagnostic lancé depuis la console, avec les informations saisies', async () => {
    const id = '33333333-4444-5555-6666-777777777777';
    const { acquittes, deps } = siteAvec([
      diag(id, {
        libre: true,
        entreprise: 'Entreprise Console',
        activite: 'Industrie',
        contexte: 'Contexte fictif',
      }),
    ]);
    const r = await releverPassations(t.app.db, deps);
    expect(r).toMatchObject({ recus: 1, enregistres: 1, inconnus: 0 });
    const vu = await relire(id);
    expect(vu).toMatchObject({
      nom: 'Entreprise Console',
      activite: 'Industrie',
      contexte: 'Contexte fictif',
    });
    expect(vu.dims).toEqual({ outils: 10, strategie: 7, polyvalence: 4 });
    expect(acquittes).toHaveLength(1);
  });

  it('un diagnostic libre sans identifiant valide reste sur le site', async () => {
    const { acquittes, deps } = siteAvec([
      diag('pas-un-uuid-du-tout', { libre: true, entreprise: 'X' }),
    ]);
    const r = await releverPassations(t.app.db, deps);
    expect(r).toMatchObject({ enregistres: 0, inconnus: 1 });
    expect(acquittes).toEqual([]);
  });

  it('laisse sur le site un diagnostic dont le projet est inconnu', async () => {
    const { acquittes, deps } = siteAvec([diag('99999999-2222-3333-4444-555555555555')]);
    const r = await releverPassations(t.app.db, deps);
    expect(r).toMatchObject({ recus: 1, enregistres: 0, inconnus: 1 });
    expect(acquittes).toEqual([]);
  });

  it('sans grille, rien n’est acquitté : les réponses restent sur le site', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Passation Fictive C',
      activite: 'services',
    });
    const garde = process.env.DIAGNOSTIC_GRILLE;
    delete process.env.DIAGNOSTIC_GRILLE;
    try {
      const { acquittes, deps } = siteAvec([diag(p.id)]);
      await expect(releverPassations(t.app.db, deps)).rejects.toBeInstanceOf(PassationImpossible);
      expect(acquittes).toEqual([]);
      expect((await relire(p.id)).passation).toBeNull();
    } finally {
      process.env.DIAGNOSTIC_GRILLE = garde;
    }
  });
});
