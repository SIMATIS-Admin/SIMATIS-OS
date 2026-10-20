import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ChatIndisponible } from './chat.js';
import { enregistrerReponses, importerEntretien, PDF_MAX, corrigerReponse } from './entretien.js';
import { ScoreIncomplet, type ReponseQuestion } from './score.js';
import { createProjet, listProjets } from './service.js';

// Grille fictive : deux rubriques ont une question numéro 1 et une question numéro 2.
const grilleFictive = {
  seuil: 6,
  questions: [
    { section: 'R1', numero: 1, libelle: 'Q1', dimension: 'outils', poids: 2 },
    { section: 'R1', numero: 2, libelle: 'Q2', dimension: 'outils', poids: 1 },
    { section: 'R2', numero: 1, libelle: 'Q3', dimension: 'strategie', poids: 1 },
    { section: 'R2', numero: 2, libelle: 'Q4', dimension: 'strategie', poids: 1 },
    { section: 'R3', numero: 1, libelle: 'Q5', dimension: 'polyvalence', poids: 1 },
  ],
};

const PDF_FICTIF = Buffer.from('%PDF-1.4 fictif').toString('base64');
const reponse = (
  section: string,
  numero: number,
  lettre: ReponseQuestion['reponse'],
): ReponseQuestion => ({
  section,
  numero,
  reponse: lettre,
});
const toutes = (
  lettres: [
    ReponseQuestion['reponse'],
    ReponseQuestion['reponse'],
    ReponseQuestion['reponse'],
    ReponseQuestion['reponse'],
    ReponseQuestion['reponse'],
  ],
): ReponseQuestion[] => [
  reponse('R1', 1, lettres[0]),
  reponse('R1', 2, lettres[1]),
  reponse('R2', 1, lettres[2]),
  reponse('R2', 2, lettres[3]),
  reponse('R3', 1, lettres[4]),
];

describe('Entretien : import du PDF, réponses et correction', () => {
  let t: TestApp;
  let simatis: Instance;
  let dossier: string;
  let grilleAvant: string | undefined;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-entretien',
      nom: 'SIMATIS',
      type: 'propre',
    });
    dossier = await mkdtemp(path.join(tmpdir(), 'entretien-'));
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

  const nouveau = (nom: string) => createProjet(t.app.db, simatis, { nom, activite: 'services' });

  // Projet dont le PDF est importé et les réponses déjà enregistrées (comme après la lecture de Claude).
  const avecReponses = async (nom: string, lettres: Parameters<typeof toutes>[0]) => {
    const p = await nouveau(nom);
    await importerEntretien(t.app.db, simatis, p.id, { nom: 'entretien.pdf', base64: PDF_FICTIF });
    await withInstance(t.app.db, simatis.id, (tx) =>
      enregistrerReponses(tx, p.id, toutes(lettres)),
    );
    return p.id;
  };

  it('importe un PDF : la demande part à l étape 2 et le PDF est gardé', async () => {
    const p = await nouveau('Entretien Fictif A');
    const vu = await importerEntretien(t.app.db, simatis, p.id, {
      nom: 'entretien.pdf',
      base64: PDF_FICTIF,
    });
    expect(vu).toMatchObject({
      demande: 'entretien',
      aPdfEntretien: true,
      pdfEntretienNom: 'entretien.pdf',
    });
    expect(vu.conversation).toEqual([expect.objectContaining({ etape: 2, de: 'pilote' })]);
  });

  it('refuse un fichier qui ne commence pas par %PDF, sans rien écrire', async () => {
    const p = await nouveau('Entretien Fictif B');
    const pasPdf = Buffer.from('texte fictif').toString('base64');
    await expect(
      importerEntretien(t.app.db, simatis, p.id, { nom: 'faux.pdf', base64: pasPdf }),
    ).rejects.toBeInstanceOf(ChatIndisponible);
    const relu = await relire(p.id);
    expect(relu.demande).toBeNull();
    expect(relu.aPdfEntretien).toBe(false);
  });

  it('refuse un PDF de plus de 10 Mo', async () => {
    const p = await nouveau('Entretien Fictif C');
    const trop = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(PDF_MAX)]).toString('base64');
    await expect(
      importerEntretien(t.app.db, simatis, p.id, { nom: 'lourd.pdf', base64: trop }),
    ).rejects.toBeInstanceOf(ChatIndisponible);
  });

  it('refuse l import quand la grille n est pas configurée, en expliquant pourquoi', async () => {
    const p = await nouveau('Entretien Fictif D');
    const avant = process.env.DIAGNOSTIC_GRILLE;
    delete process.env.DIAGNOSTIC_GRILLE;
    try {
      await expect(
        importerEntretien(t.app.db, simatis, p.id, { nom: 'entretien.pdf', base64: PDF_FICTIF }),
      ).rejects.toThrow(/DIAGNOSTIC_GRILLE non défini/);
    } finally {
      process.env.DIAGNOSTIC_GRILLE = avant;
    }
    expect((await relire(p.id)).demande).toBeNull();
  });

  it('enregistre les réponses, calcule le profil et termine la demande', async () => {
    const p = await nouveau('Entretien Fictif E');
    await importerEntretien(t.app.db, simatis, p.id, { nom: 'entretien.pdf', base64: PDF_FICTIF });
    await withInstance(t.app.db, simatis.id, (tx) =>
      enregistrerReponses(tx, p.id, toutes(['A', 'A', 'A', 'A', 'A'])),
    );
    const relu = await relire(p.id);
    expect(relu.dims).toEqual({ outils: 10, strategie: 10, polyvalence: 10 });
    expect(relu.profil).toBe('Ultra-endurant');
    expect(relu.demande).toBeNull();
    expect(relu.reponsesEntretien).toHaveLength(5);
  });

  it('une réponse manquante refuse tout, sans rien écrire', async () => {
    const p = await nouveau('Entretien Fictif F');
    await importerEntretien(t.app.db, simatis, p.id, { nom: 'entretien.pdf', base64: PDF_FICTIF });
    const incomplet = toutes(['A', 'A', 'A', 'A', 'A']).filter(
      (r) => r.section !== 'R2' || r.numero !== 2,
    );
    await expect(
      withInstance(t.app.db, simatis.id, (tx) => enregistrerReponses(tx, p.id, incomplet)),
    ).rejects.toBeInstanceOf(ScoreIncomplet);
    const relu = await relire(p.id);
    expect(relu.dims).toBeNull();
    expect(relu.reponsesEntretien).toEqual([]);
    expect(relu.demande).toBe('entretien');
  });

  it('une correction fait monter le profil et garde l ancienne valeur', async () => {
    const id = await avecReponses('Entretien Fictif G', ['E', 'E', 'A', 'A', 'A']);
    expect((await relire(id)).profil).toBe('Joggeur');
    const vu = await corrigerReponse(t.app.db, simatis, id, { section: 'R1', numero: 1 }, 'A');
    expect(vu.profil).toBe('Ultra-endurant');
    expect(vu.historiqueReponses).toEqual([
      expect.objectContaining({ question: 'R1#1', ancienne: 'E', nouvelle: 'A' }),
    ]);
  });

  it('une correction qui vide une dimension est refusée, sans rien changer', async () => {
    const id = await avecReponses('Entretien Fictif H', ['A', 'A', 'A', 'A', 'A']);
    await expect(
      corrigerReponse(t.app.db, simatis, id, { section: 'R3', numero: 1 }, 'N/A'),
    ).rejects.toBeInstanceOf(ChatIndisponible);
    const relu = await relire(id);
    expect(relu.dims).toEqual({ outils: 10, strategie: 10, polyvalence: 10 });
    expect(relu.historiqueReponses).toEqual([]);
  });
});
