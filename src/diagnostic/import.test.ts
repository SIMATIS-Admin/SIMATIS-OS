import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance } from '../instances/service.js';
import type { Instance } from '../instances/schema.js';
import { importerProjets, importSchema, type ImportEntree } from './import.js';
import { DiagnosticIndisponible, listProjets, ProjetIntrouvable, rapportDe } from './service.js';

const contenu = Buffer.from('faux contenu de rapport, fictif').toString('base64');
const entrees: ImportEntree[] = [
  {
    nom: 'Atelier Fictif Nord',
    activite: 'autre',
    contexte: 'Contexte fictif.',
    etape: 3,
    dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
    statutDiagnostic: 'Rapport à rédiger',
    dateDiagnostic: '2026-10-06',
    revue: { statut: 'envoyé', preconisations: { r1: { detail: 'Commentaire fictif de Marc.' } } },
    rapport: { nom: 'Rapport fictif.docx', base64: contenu },
  },
  { nom: 'Bureau Fictif Sud', activite: 'services', etape: 1, dateDiagnostic: '2026-10-26' },
];

describe('Import des projets de diagnostic', () => {
  let t: TestApp;
  let simatis: Instance;
  let mandat: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-import',
      nom: 'SIMATIS',
      type: 'propre',
    });
    mandat = await createInstance(t.owner.db, {
      slug: 'mandat-import',
      nom: 'Mandat',
      type: 'mandat',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  it('crée les projets, avec leur formulaire et leur rapport', async () => {
    const r = await importerProjets(t.app.db, simatis, entrees);
    expect(r).toEqual({
      crees: ['Atelier Fictif Nord', 'Bureau Fictif Sud'],
      deja: [],
      completes: [],
    });

    const projets = await listProjets(t.app.db, simatis);
    const nord = projets.find((p) => p.nom === 'Atelier Fictif Nord');
    expect(nord).toMatchObject({
      etape: 3,
      profil: 'Joggeur',
      aRapport: true,
      rapportNom: 'Rapport fictif.docx',
    });
    expect(nord?.revue).toMatchObject({ statut: 'envoyé' });
    // Le contenu du rapport ne voyage pas avec la liste.
    expect(nord).not.toHaveProperty('rapport');
  });

  it('ne réécrit jamais un projet déjà présent', async () => {
    const r = await importerProjets(t.app.db, simatis, entrees);
    expect(r).toEqual({
      crees: [],
      deja: ['Atelier Fictif Nord', 'Bureau Fictif Sud'],
      completes: [],
    });
    expect(await listProjets(t.app.db, simatis)).toHaveLength(2);
  });

  it('ajoute un support archivé à un projet existant, une seule fois', async () => {
    const support = {
      lien: 'https://claude.ai/artifact/DeckFictif01',
      finalLe: '2026-10-06',
      diapositives: [{ titre: 'Couverture fictive', texte: 'Texte', notes: 'Notes' }],
    };
    const avec = [{ ...entrees[0]!, support }];
    expect(await importerProjets(t.app.db, simatis, avec)).toMatchObject({
      completes: ['Atelier Fictif Nord'],
    });
    const nord = (await listProjets(t.app.db, simatis)).find(
      (p) => p.nom === 'Atelier Fictif Nord',
    );
    expect(nord).toMatchObject({ supportStatut: 'final', supportLien: support.lien });
    expect(
      await importerProjets(t.app.db, simatis, [
        {
          ...entrees[0]!,
          support: { ...support, lien: 'https://claude.ai/artifact/AutreFictif1' },
        },
      ]),
    ).toMatchObject({ completes: [], deja: ['Atelier Fictif Nord'] });
  });

  it('rend le rapport téléchargeable tel qu il a été importé', async () => {
    const projet = (await listProjets(t.app.db, simatis)).find(
      (p) => p.nom === 'Atelier Fictif Nord',
    );
    const { nom, contenu: octets } = await rapportDe(t.app.db, simatis, projet!.id);
    expect(nom).toBe('Rapport fictif.docx');
    expect(octets.toString('utf8')).toBe('faux contenu de rapport, fictif');
  });

  it('signale un projet sans rapport et un identifiant inconnu', async () => {
    const sans = (await listProjets(t.app.db, simatis)).find((p) => p.nom === 'Bureau Fictif Sud');
    await expect(rapportDe(t.app.db, simatis, sans!.id)).rejects.toBeInstanceOf(ProjetIntrouvable);
    await expect(
      rapportDe(t.app.db, simatis, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(ProjetIntrouvable);
  });

  it('refuse l import dans un mandat', async () => {
    await expect(importerProjets(t.app.db, mandat, entrees)).rejects.toBeInstanceOf(
      DiagnosticIndisponible,
    );
  });

  it('refuse un fichier avec une activité inconnue', () => {
    const invalide = { projets: [{ nom: 'X', activite: 'inconnue', etape: 1 }] };
    expect(importSchema.safeParse(invalide).success).toBe(false);
    expect(importSchema.safeParse({ projets: entrees }).success).toBe(true);
  });
});
