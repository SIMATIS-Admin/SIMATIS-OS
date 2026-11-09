import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ChatIndisponible, demarrerAttente, finirAttente } from './chat.js';
import { autoriserSiDossier, demanderDossier, enregistrerDossier } from './dossier-export.js';
import { createProjet, listProjets, updateProjet } from './service.js';
import { SupportInvalide } from './support.js';

const LIEN_1 = 'https://claude.ai/artifact/DossierFictif0001';
const LIEN_2 = 'https://claude.ai/artifact/DossierFictif0002';
const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };

describe('Dossier de travail du rapport en artefact', () => {
  let t: TestApp;
  let simatis: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-dossier-export',
      nom: 'SIMATIS',
      type: 'propre',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const relire = async (id: string) =>
    (await listProjets(t.app.db, simatis)).find((p) => p.id === id)!;

  // Projet avec un résultat saisi, sans revue : le dossier se prépare même sans revue validée.
  const projet = async (nom: string, avecResultat = true) => {
    const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
    if (avecResultat) await updateProjet(t.app.db, simatis, p.id, { dims });
    return p.id;
  };

  const enCours = async (nom: string) => {
    const id = await projet(nom);
    await demanderDossier(t.app.db, simatis, id);
    await demarrerAttente(t.app.db, simatis, id);
    return id;
  };

  const enregistrer = (id: string, lien: string) =>
    withInstance(t.app.db, simatis.id, (tx) => enregistrerDossier(tx, id, lien));

  it('refuse sans résultat saisi et n écrit rien', async () => {
    const id = await projet('Dossier Fictif A', false);
    await expect(demanderDossier(t.app.db, simatis, id)).rejects.toThrow(
      "Saisissez d'abord le résultat à l'étape 2.",
    );
    expect(await relire(id)).toMatchObject({ demande: null, dossierExportStatut: 'aucun' });
  });

  it('pose la demande à l étape 4 et passe le dossier en cours', async () => {
    const id = await projet('Dossier Fictif B');
    const envoye = await demanderDossier(t.app.db, simatis, id);
    expect(envoye).toMatchObject({ demande: 'dossier_exporter', dossierExportStatut: 'en_cours' });
    expect(envoye.conversation.at(-1)).toMatchObject({
      etape: 4,
      de: 'pilote',
      texte: 'Préparer le dossier de travail du rapport.',
    });
  });

  it('refuse un second clic pendant la préparation', async () => {
    const id = await projet('Dossier Fictif C');
    await demanderDossier(t.app.db, simatis, id);
    await expect(demanderDossier(t.app.db, simatis, id)).rejects.toBeInstanceOf(ChatIndisponible);
  });

  it('refuse un lien hors claude.ai et ne change rien', async () => {
    const id = await enCours('Dossier Fictif D');
    await expect(enregistrer(id, 'https://example.com/artifact/Faux12345')).rejects.toBeInstanceOf(
      SupportInvalide,
    );
    expect(await relire(id)).toMatchObject({
      dossierExportLien: null,
      dossierExportStatut: 'en_cours',
    });
    await finirAttente(t.app.db, simatis, id);
  });

  it('refuse un lien sans demande de dossier', async () => {
    const id = await projet('Dossier Fictif E');
    await expect(enregistrer(id, LIEN_1)).rejects.toBeInstanceOf(SupportInvalide);
  });

  it('enregistre le lien, passe à prêt, et le remplace à la nouvelle demande', async () => {
    const id = await enCours('Dossier Fictif F');
    await enregistrer(id, LIEN_1);
    await finirAttente(t.app.db, simatis, id);
    expect(await relire(id)).toMatchObject({
      dossierExportLien: LIEN_1,
      dossierExportStatut: 'pret',
    });
    await demanderDossier(t.app.db, simatis, id);
    await demarrerAttente(t.app.db, simatis, id);
    await enregistrer(id, LIEN_2);
    expect(await relire(id)).toMatchObject({
      dossierExportLien: LIEN_2,
      dossierExportStatut: 'pret',
    });
    await finirAttente(t.app.db, simatis, id);
  });

  it('une préparation sans lien redevient possible ; avec un lien déjà là, il est conservé', async () => {
    const id = await enCours('Dossier Fictif G');
    await finirAttente(t.app.db, simatis, id);
    expect(await relire(id)).toMatchObject({
      dossierExportLien: null,
      dossierExportStatut: 'aucun',
    });
    const avecLien = await enCours('Dossier Fictif H');
    await enregistrer(avecLien, LIEN_1);
    await finirAttente(t.app.db, simatis, avecLien);
    await demanderDossier(t.app.db, simatis, avecLien);
    await demarrerAttente(t.app.db, simatis, avecLien);
    await finirAttente(t.app.db, simatis, avecLien);
    expect(await relire(avecLien)).toMatchObject({
      dossierExportLien: LIEN_1,
      dossierExportStatut: 'pret',
    });
  });

  describe('permissions pendant la préparation', () => {
    const decider = (outil: string, input: Record<string, unknown>) =>
      withInstance(t.app.db, simatis.id, (tx) => autoriserSiDossier(tx, outil, input));

    it('ne décide de rien hors préparation du dossier', async () => {
      await projet('Dossier Fictif I');
      expect(await decider('Artifact', { action: 'publish' })).toBeNull();
    });

    it('autorise la création, pas un autre outil', async () => {
      const id = await enCours('Dossier Fictif J');
      expect(await decider('Artifact', { action: 'quickstart' })).toMatchObject({
        behavior: 'allow',
      });
      expect(await decider('Artifact', { action: 'publish' })).toMatchObject({ behavior: 'allow' });
      expect(await decider('Bash', { command: 'ls' })).toMatchObject({ behavior: 'deny' });
      await finirAttente(t.app.db, simatis, id);
    });

    it('refuse de publier sur un autre artifact que celui du projet', async () => {
      const id = await enCours('Dossier Fictif K');
      await enregistrer(id, LIEN_1);
      expect(await decider('Artifact', { action: 'publish', url: LIEN_1 })).toMatchObject({
        behavior: 'allow',
      });
      expect(await decider('Artifact', { action: 'publish', url: LIEN_2 })).toMatchObject({
        behavior: 'deny',
      });
      await finirAttente(t.app.db, simatis, id);
    });
  });
});
