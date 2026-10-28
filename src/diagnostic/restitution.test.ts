import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ChatIndisponible, demarrerAttente, finirAttente } from './chat.js';
import { contenuRapportFictif } from './fixtures/rapport-fictif.js';
import { demanderRapport, enregistrerRapport } from './rapport.js';
import {
  autoriserSiRestitution,
  demanderExportRestitution,
  demanderRestitution,
  enregistrerDiapositivesRestitution,
  enregistrerRestitution,
  pptxRestitutionDe,
  restitutionPrete,
} from './restitution.js';
import { createProjet, listProjets, ProjetIntrouvable, updateProjet } from './service.js';
import { SupportInvalide } from './support.js';

const LIEN_1 = 'https://claude.ai/artifact/RestitutionFictive01';
const LIEN_2 = 'https://claude.ai/artifact/RestitutionFictive02';
const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };

describe('Restitution : pré-requis', () => {
  it('exige un rapport produit ou importé', () => {
    expect(restitutionPrete({ rapportVersions: [], rapportNom: null })).toEqual({
      ok: false,
      raison: "Produisez d'abord le rapport à l'étape 4.",
    });
    expect(restitutionPrete({ rapportVersions: [], rapportNom: 'importe.docx' })).toEqual({
      ok: true,
    });
  });
});

describe('Deck de restitution', () => {
  let t: TestApp;
  let simatis: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-restitution',
      nom: 'SIMATIS',
      type: 'propre',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const relire = async (id: string) =>
    (await listProjets(t.app.db, simatis)).find((p) => p.id === id)!;

  // Projet avec un rapport produit.
  const avecRapport = async (nom: string) => {
    const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
    await updateProjet(t.app.db, simatis, p.id, { dims });
    await demanderRapport(t.app.db, simatis, p.id);
    await demarrerAttente(t.app.db, simatis, p.id);
    await withInstance(t.app.db, simatis.id, (tx) =>
      enregistrerRapport(tx, p.id, contenuRapportFictif),
    );
    await finirAttente(t.app.db, simatis, p.id);
    return p.id;
  };

  const enCours = async (nom: string) => {
    const id = await avecRapport(nom);
    await demanderRestitution(t.app.db, simatis, id);
    await demarrerAttente(t.app.db, simatis, id);
    return id;
  };

  const enregistrer = (id: string, lien: string) =>
    withInstance(t.app.db, simatis.id, (tx) => enregistrerRestitution(tx, id, lien));

  it('refuse sans rapport et n écrit rien', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Restitution Fictive A',
      activite: 'services',
    });
    await expect(demanderRestitution(t.app.db, simatis, p.id)).rejects.toThrow(
      "Produisez d'abord le rapport à l'étape 4.",
    );
    const relu = await relire(p.id);
    expect(relu.demande).toBeNull();
    expect(relu.restitutionStatut).toBe('aucun');
  });

  it('pose la demande à l étape 5 et passe le deck en cours', async () => {
    const id = await avecRapport('Restitution Fictive B');
    const envoye = await demanderRestitution(t.app.db, simatis, id);
    expect(envoye).toMatchObject({ demande: 'restitution', restitutionStatut: 'en_cours' });
    expect(envoye.conversation.at(-1)).toMatchObject({
      etape: 5,
      de: 'pilote',
      texte: 'Produire le deck de restitution.',
    });
  });

  it('refuse un second clic pendant la création', async () => {
    const id = await avecRapport('Restitution Fictive C');
    await demanderRestitution(t.app.db, simatis, id);
    await expect(demanderRestitution(t.app.db, simatis, id)).rejects.toBeInstanceOf(
      ChatIndisponible,
    );
  });

  it('refuse un lien hors claude.ai et ne change rien', async () => {
    const id = await enCours('Restitution Fictive D');
    await expect(enregistrer(id, 'https://example.com/artifact/Faux12345')).rejects.toBeInstanceOf(
      SupportInvalide,
    );
    expect(await relire(id)).toMatchObject({
      restitutionLien: null,
      restitutionStatut: 'en_cours',
    });
  });

  it('refuse un lien sans demande de restitution', async () => {
    const id = await avecRapport('Restitution Fictive E');
    await expect(enregistrer(id, LIEN_1)).rejects.toBeInstanceOf(SupportInvalide);
  });

  it('pose le lien, passe à prêt, et garde l ancien deck dans l historique', async () => {
    const id = await enCours('Restitution Fictive F');
    await enregistrer(id, LIEN_1);
    await finirAttente(t.app.db, simatis, id);
    expect(await relire(id)).toMatchObject({ restitutionLien: LIEN_1, restitutionStatut: 'pret' });
    await demanderRestitution(t.app.db, simatis, id);
    await demarrerAttente(t.app.db, simatis, id);
    await enregistrer(id, LIEN_2);
    const relu = await relire(id);
    expect(relu.restitutionLien).toBe(LIEN_2);
    expect(relu.restitutionLiens.map((r) => r.lien)).toEqual([LIEN_2, LIEN_1]);
  });

  it('sans lien à la fin, le deck repasse à aucun', async () => {
    const id = await enCours('Restitution Fictive G');
    await finirAttente(t.app.db, simatis, id, 'Claude ne répond pas.');
    expect(await relire(id)).toMatchObject({ restitutionStatut: 'aucun', demande: null });
  });

  it('autorise la création et la publication sur le seul deck du projet', async () => {
    const instance = await createInstance(t.owner.db, {
      slug: 'simatis-restitution-auto',
      nom: 'SIMATIS',
      type: 'propre',
    });
    const p = await createProjet(t.app.db, instance, {
      nom: 'Restitution Fictive H',
      activite: 'services',
    });
    await updateProjet(t.app.db, instance, p.id, { dims });
    await demanderRapport(t.app.db, instance, p.id);
    await demarrerAttente(t.app.db, instance, p.id);
    await withInstance(t.app.db, instance.id, (tx) =>
      enregistrerRapport(tx, p.id, contenuRapportFictif),
    );
    await finirAttente(t.app.db, instance, p.id);
    await demanderRestitution(t.app.db, instance, p.id);
    await demarrerAttente(t.app.db, instance, p.id);
    await withInstance(t.app.db, instance.id, (tx) => enregistrerRestitution(tx, p.id, LIEN_1));
    const decider = (outil: string, input: Record<string, unknown>) =>
      withInstance(t.app.db, instance.id, (tx) => autoriserSiRestitution(tx, outil, input));
    expect(await decider('Artifact', { action: 'publish' })).toMatchObject({ behavior: 'allow' });
    expect(await decider('Artifact', { action: 'quickstart', intent: 'slides' })).toMatchObject({
      behavior: 'allow',
    });
    expect(await decider('Artifact', { action: 'publish', url: LIEN_1 })).toMatchObject({
      behavior: 'allow',
    });
    expect(await decider('Artifact', { action: 'publish', url: LIEN_2 })).toMatchObject({
      behavior: 'deny',
    });
    expect(await decider('Artifact', { action: 'delete', url: LIEN_1 })).toMatchObject({
      behavior: 'deny',
    });
    expect(await decider('Bash', {})).toMatchObject({ behavior: 'deny' });
  });

  it('ne se prononce pas hors d une demande de restitution', async () => {
    const id = await avecRapport('Restitution Fictive I');
    void id;
    const decision = await withInstance(t.app.db, simatis.id, (tx) =>
      autoriserSiRestitution(tx, 'Artifact', { action: 'publish' }),
    );
    expect(decision).toBeNull();
  });
  describe('export PowerPoint', () => {
    const DIAPOS = [
      { titre: 'Couverture fictive', texte: 'Sous-titre fictif', notes: 'Accueil, 5 min' },
      { titre: 'Résultats fictifs', texte: 'Ligne 1\nLigne 2', notes: '15 min' },
    ];
    // Deck prêt : lien enregistré, Claude a fini.
    const deckPret = async (nom: string) => {
      const id = await enCours(nom);
      await enregistrer(id, LIEN_1);
      await finirAttente(t.app.db, simatis, id);
      return id;
    };
    const enregistrerDiapos = (id: string) =>
      withInstance(t.app.db, simatis.id, (tx) =>
        enregistrerDiapositivesRestitution(tx, id, DIAPOS),
      );

    it('refuse l export sans deck enregistré', async () => {
      const id = await avecRapport('Export Fictif A');
      await expect(demanderExportRestitution(t.app.db, simatis, id)).rejects.toThrow(
        /Aucun deck de restitution/,
      );
      expect((await relire(id)).demande).toBeNull();
    });

    it('pose la demande sans toucher au statut du deck', async () => {
      const id = await deckPret('Export Fictif B');
      const envoye = await demanderExportRestitution(t.app.db, simatis, id);
      expect(envoye).toMatchObject({ demande: 'restitution_export', restitutionStatut: 'pret' });
      expect(envoye.conversation.at(-1)).toMatchObject({ etape: 5, de: 'pilote' });
    });

    it('refuse l export pendant la création du deck', async () => {
      const id = await enCours('Export Fictif C');
      await enregistrer(id, LIEN_1);
      await expect(demanderExportRestitution(t.app.db, simatis, id)).rejects.toBeInstanceOf(
        ChatIndisponible,
      );
    });

    it('refuse des diapositives sans demande d export', async () => {
      const id = await deckPret('Export Fictif D');
      await expect(enregistrerDiapos(id)).rejects.toBeInstanceOf(SupportInvalide);
      expect((await relire(id)).aPptx).toBe(false);
    });

    it('n a pas de PowerPoint avant un export', async () => {
      const id = await deckPret('Export Fictif E');
      await expect(pptxRestitutionDe(t.app.db, simatis, id)).rejects.toBeInstanceOf(
        ProjetIntrouvable,
      );
    });

    it('enregistre les diapositives lues, puis le PowerPoint se télécharge', async () => {
      const id = await deckPret('Export Fictif F');
      await demanderExportRestitution(t.app.db, simatis, id);
      await demarrerAttente(t.app.db, simatis, id);
      await enregistrerDiapos(id);
      await finirAttente(t.app.db, simatis, id);
      const relu = await relire(id);
      expect(relu.aPptx).toBe(true);
      expect(relu.restitutionExportLe).not.toBeNull();
      expect(relu).not.toHaveProperty('restitutionDiapos');
      const { nom, contenu } = await pptxRestitutionDe(t.app.db, simatis, id);
      expect(nom).toBe('Restitution - Export Fictif F.pptx');
      expect(Array.from(contenu.subarray(0, 2))).toEqual([0x50, 0x4b]);
    });

    it('pendant l export, seule la lecture du deck est permise', async () => {
      const instance = await createInstance(t.owner.db, {
        slug: 'simatis-restitution-export',
        nom: 'SIMATIS',
        type: 'propre',
      });
      const p = await createProjet(t.app.db, instance, {
        nom: 'Export Fictif G',
        activite: 'services',
      });
      await updateProjet(t.app.db, instance, p.id, { dims });
      await demanderRapport(t.app.db, instance, p.id);
      await demarrerAttente(t.app.db, instance, p.id);
      await withInstance(t.app.db, instance.id, (tx) =>
        enregistrerRapport(tx, p.id, contenuRapportFictif),
      );
      await finirAttente(t.app.db, instance, p.id);
      await demanderRestitution(t.app.db, instance, p.id);
      await demarrerAttente(t.app.db, instance, p.id);
      await withInstance(t.app.db, instance.id, (tx) => enregistrerRestitution(tx, p.id, LIEN_1));
      await finirAttente(t.app.db, instance, p.id);
      await demanderExportRestitution(t.app.db, instance, p.id);
      await demarrerAttente(t.app.db, instance, p.id);
      const decider = (outil: string, input: Record<string, unknown>) =>
        withInstance(t.app.db, instance.id, (tx) => autoriserSiRestitution(tx, outil, input));
      expect(await decider('Artifact', { action: 'read', url: LIEN_1 })).toMatchObject({
        behavior: 'allow',
      });
      for (const input of [
        { action: 'publish', url: LIEN_1 },
        { action: 'publish' },
        { action: 'quickstart', intent: 'slides' },
        { action: 'delete', url: LIEN_1 },
      ])
        expect(await decider('Artifact', input)).toMatchObject({ behavior: 'deny' });
      expect(await decider('Bash', {})).toMatchObject({ behavior: 'deny' });
    });
  });
});
