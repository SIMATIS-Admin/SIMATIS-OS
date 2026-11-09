import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ChatIndisponible, demarrerAttente, finirAttente } from './chat.js';
import {
  autoriserSiExportRevue,
  demanderExportRevue,
  enregistrerExportRevue,
} from './revue-export.js';
import { createProjet, listProjets, updateProjet } from './service.js';
import { SupportInvalide } from './support.js';

const LIEN_1 = 'https://claude.ai/artifact/RevueFictive0001';
const LIEN_2 = 'https://claude.ai/artifact/RevueFictive0002';
const validee = {
  statut: 'validée',
  preconisations: { r1: { titre: 'Fictive', choix: 'retenue' } },
};

describe('Export de la revue en artefact', () => {
  let t: TestApp;
  let simatis: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-revue-export',
      nom: 'SIMATIS',
      type: 'propre',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const relire = async (id: string) =>
    (await listProjets(t.app.db, simatis)).find((p) => p.id === id)!;

  const projet = async (nom: string, revue: Record<string, unknown> | null = validee) => {
    const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
    if (revue) await updateProjet(t.app.db, simatis, p.id, { revue });
    return p.id;
  };

  const enCours = async (nom: string) => {
    const id = await projet(nom);
    await demanderExportRevue(t.app.db, simatis, id);
    await demarrerAttente(t.app.db, simatis, id);
    return id;
  };

  const enregistrer = (id: string, lien: string) =>
    withInstance(t.app.db, simatis.id, (tx) => enregistrerExportRevue(tx, id, lien));

  it('refuse sans revue, ou avec une revue en brouillon, et n écrit rien', async () => {
    const sans = await projet('Export Fictif A', null);
    await expect(demanderExportRevue(t.app.db, simatis, sans)).rejects.toThrow(
      "Validez d'abord la revue à l'étape 3.",
    );
    const brouillon = await projet('Export Fictif B', { statut: 'brouillon' });
    await expect(demanderExportRevue(t.app.db, simatis, brouillon)).rejects.toBeInstanceOf(
      ChatIndisponible,
    );
    expect(await relire(brouillon)).toMatchObject({ demande: null, revueExportStatut: 'aucun' });
  });

  it('pose la demande à l étape 3 et passe l export en cours', async () => {
    const id = await projet('Export Fictif C');
    const envoye = await demanderExportRevue(t.app.db, simatis, id);
    expect(envoye).toMatchObject({ demande: 'revue_exporter', revueExportStatut: 'en_cours' });
    expect(envoye.conversation.at(-1)).toMatchObject({
      etape: 3,
      de: 'pilote',
      texte: 'Exporter la revue pour Claude Chat.',
    });
  });

  it('refuse un second clic pendant l export', async () => {
    const id = await projet('Export Fictif D');
    await demanderExportRevue(t.app.db, simatis, id);
    await expect(demanderExportRevue(t.app.db, simatis, id)).rejects.toBeInstanceOf(
      ChatIndisponible,
    );
  });

  it('refuse un lien hors claude.ai et ne change rien', async () => {
    const id = await enCours('Export Fictif E');
    await expect(enregistrer(id, 'https://example.com/artifact/Faux12345')).rejects.toBeInstanceOf(
      SupportInvalide,
    );
    expect(await relire(id)).toMatchObject({
      revueExportLien: null,
      revueExportStatut: 'en_cours',
    });
    await finirAttente(t.app.db, simatis, id);
  });

  it('refuse un lien sans demande d export', async () => {
    const id = await projet('Export Fictif F');
    await expect(enregistrer(id, LIEN_1)).rejects.toBeInstanceOf(SupportInvalide);
  });

  it('enregistre le lien, passe à prêt, et le remplace à la nouvelle demande', async () => {
    const id = await enCours('Export Fictif G');
    await enregistrer(id, LIEN_1);
    await finirAttente(t.app.db, simatis, id);
    expect(await relire(id)).toMatchObject({ revueExportLien: LIEN_1, revueExportStatut: 'pret' });
    await demanderExportRevue(t.app.db, simatis, id);
    await demarrerAttente(t.app.db, simatis, id);
    await enregistrer(id, LIEN_2);
    expect(await relire(id)).toMatchObject({ revueExportLien: LIEN_2, revueExportStatut: 'pret' });
    await finirAttente(t.app.db, simatis, id);
  });

  it('un export sans lien enregistré redevient possible à la fin du travail', async () => {
    const id = await enCours('Export Fictif H');
    await finirAttente(t.app.db, simatis, id);
    expect(await relire(id)).toMatchObject({ revueExportLien: null, revueExportStatut: 'aucun' });
    // Avec un lien déjà enregistré avant, l'échec le conserve.
    const avecLien = await enCours('Export Fictif I');
    await enregistrer(avecLien, LIEN_1);
    await finirAttente(t.app.db, simatis, avecLien);
    await demanderExportRevue(t.app.db, simatis, avecLien);
    await demarrerAttente(t.app.db, simatis, avecLien);
    await finirAttente(t.app.db, simatis, avecLien);
    expect(await relire(avecLien)).toMatchObject({
      revueExportLien: LIEN_1,
      revueExportStatut: 'pret',
    });
  });

  describe('permissions pendant l export', () => {
    const decider = (outil: string, input: Record<string, unknown>) =>
      withInstance(t.app.db, simatis.id, (tx) => autoriserSiExportRevue(tx, outil, input));

    it('ne décide de rien hors export de revue', async () => {
      await projet('Export Fictif J');
      expect(await decider('Artifact', { action: 'publish' })).toBeNull();
    });

    it('autorise la création et la lecture, pas un autre outil', async () => {
      const id = await enCours('Export Fictif K');
      expect(await decider('Artifact', { action: 'quickstart' })).toMatchObject({
        behavior: 'allow',
      });
      expect(await decider('Artifact', { action: 'publish' })).toMatchObject({ behavior: 'allow' });
      expect(await decider('Bash', { command: 'ls' })).toMatchObject({ behavior: 'deny' });
      await finirAttente(t.app.db, simatis, id);
    });

    it('refuse de publier sur un autre artifact que celui du projet', async () => {
      const id = await enCours('Export Fictif L');
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
