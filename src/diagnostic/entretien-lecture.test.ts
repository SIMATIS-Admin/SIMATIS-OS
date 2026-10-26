import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { importerEntretien } from './entretien.js';
import { LectureImpossible } from './lecture-pdf.js';
import { createProjet, listProjets } from './service.js';

// Le PDF et son tableau sont couverts par lecture-pdf.test.ts : ici, seul l'enchaînement de
// l'import avec une lecture réussie ou impossible.
const lecture = vi.hoisted(() => ({ lireRapport: vi.fn() }));
vi.mock('./lecture-pdf.js', async (original) => ({
  ...(await original<typeof import('./lecture-pdf.js')>()),
  chargerCorrespondance: () => [],
  lireRapport: lecture.lireRapport,
}));

const grilleFictive = {
  seuil: 6,
  questions: [
    { section: 'R1', numero: 1, libelle: 'Q1', dimension: 'outils', poids: 1 },
    { section: 'R2', numero: 1, libelle: 'Q2', dimension: 'strategie', poids: 1 },
    { section: 'R3', numero: 1, libelle: 'Q3', dimension: 'polyvalence', poids: 1 },
  ],
};
const PDF_FICTIF = Buffer.from('%PDF-1.4 fictif').toString('base64');
const lettres = (a: 'A' | 'D', b: 'A' | 'D', c: 'A' | 'D') => [
  { section: 'R1', numero: 1, reponse: a },
  { section: 'R2', numero: 1, reponse: b },
  { section: 'R3', numero: 1, reponse: c },
];

describe('Entretien : lecture directe du PDF', () => {
  let t: TestApp;
  let simatis: Instance;
  let dossier: string;
  const avant = { ...process.env };

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-lecture',
      nom: 'SIMATIS',
      type: 'propre',
    });
    dossier = await mkdtemp(path.join(tmpdir(), 'lecture-'));
    const grille = path.join(dossier, 'grille.json');
    await writeFile(grille, JSON.stringify(grilleFictive));
    process.env.DIAGNOSTIC_GRILLE = grille;
    process.env.DIAGNOSTIC_CORRESPONDANCE = path.join(dossier, 'correspondance.json');
  });

  afterAll(async () => {
    process.env.DIAGNOSTIC_GRILLE = avant.DIAGNOSTIC_GRILLE;
    process.env.DIAGNOSTIC_CORRESPONDANCE = avant.DIAGNOSTIC_CORRESPONDANCE;
    if (avant.DIAGNOSTIC_GRILLE === undefined) delete process.env.DIAGNOSTIC_GRILLE;
    if (avant.DIAGNOSTIC_CORRESPONDANCE === undefined) delete process.env.DIAGNOSTIC_CORRESPONDANCE;
    await rm(dossier, { recursive: true, force: true });
    await t.drop();
  });

  const nouveau = (nom: string) => createProjet(t.app.db, simatis, { nom, activite: 'services' });
  const importer = (id: string) =>
    importerEntretien(t.app.db, simatis, id, { nom: 'rapport.pdf', base64: PDF_FICTIF });

  it('enregistre les réponses et le profil tout de suite, sans demande à Claude', async () => {
    lecture.lireRapport.mockResolvedValueOnce(lettres('D', 'A', 'A'));
    const p = await nouveau('Lecture Fictive A');
    const vu = await importer(p.id);
    expect(vu).toMatchObject({
      demande: null,
      statutChat: 'repos',
      aPdfEntretien: true,
      pdfEntretienNom: 'rapport.pdf',
      dims: { outils: 1, strategie: 10, polyvalence: 10 },
      profil: 'Joggeur',
    });
    expect(vu.reponsesEntretien).toHaveLength(3);
    expect(vu.conversation).toEqual([]);
  });

  it('un nouveau PDF remplace les réponses et efface l’historique des corrections', async () => {
    lecture.lireRapport.mockResolvedValueOnce(lettres('A', 'A', 'A'));
    const p = await nouveau('Lecture Fictive B');
    await importer(p.id);
    lecture.lireRapport.mockResolvedValueOnce(lettres('A', 'D', 'A'));
    await importer(p.id);
    const relu = (await listProjets(t.app.db, simatis)).find((x) => x.id === p.id)!;
    expect(relu.dims).toEqual({ outils: 10, strategie: 1, polyvalence: 10 });
    expect(relu.historiqueReponses).toEqual([]);
  });

  it('retombe sur la lecture par Claude quand le PDF n’a pas la forme attendue', async () => {
    lecture.lireRapport.mockRejectedValueOnce(new LectureImpossible('autre forme'));
    const p = await nouveau('Lecture Fictive C');
    const vu = await importer(p.id);
    expect(vu).toMatchObject({ demande: 'entretien', statutChat: 'attente_claude' });
    expect(vu.reponsesEntretien).toEqual([]);
  });

  it('retombe sur Claude quand la correspondance n’est pas configurée', async () => {
    const avantVar = process.env.DIAGNOSTIC_CORRESPONDANCE;
    delete process.env.DIAGNOSTIC_CORRESPONDANCE;
    const appels = lecture.lireRapport.mock.calls.length;
    try {
      const p = await nouveau('Lecture Fictive D');
      const vu = await importer(p.id);
      expect(vu.demande).toBe('entretien');
      expect(lecture.lireRapport.mock.calls).toHaveLength(appels);
    } finally {
      process.env.DIAGNOSTIC_CORRESPONDANCE = avantVar;
    }
  });
});
