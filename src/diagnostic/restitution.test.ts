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
  demanderReglesRestitution,
  diapositivesRestitutionDe,
  enregistrerPdfDeck,
  enregistrerRestitution,
  pdfDeckDe,
  importerDeckRestitution,
  purgerDiapositivesRestitution,
  marquerDeckFinal,
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
  describe('version finale du deck', () => {
    const deckPret = async (nom: string, lien = LIEN_1) => {
      const id = await enCours(nom);
      await enregistrer(id, lien);
      await finirAttente(t.app.db, simatis, id);
      return id;
    };

    it('cocher pose la finale seule et lance la capitalisation à l étape 5', async () => {
      const id = await deckPret('Finale Fictive A');
      const vue = await marquerDeckFinal(t.app.db, simatis, id, LIEN_1, true);
      expect(vue.demande).toBe('regles_restitution');
      expect(vue.conversation.at(-1)).toMatchObject({
        etape: 5,
        de: 'pilote',
        texte: 'Capitaliser le deck de restitution final.',
      });
      expect((await relire(id)).restitutionLiens.filter((l) => l.finale)).toHaveLength(1);
    });

    it('déplace la finale sur un autre deck du même projet', async () => {
      const id = await deckPret('Finale Fictive B');
      await marquerDeckFinal(t.app.db, simatis, id, LIEN_1, true);
      await demarrerAttente(t.app.db, simatis, id);
      await finirAttente(t.app.db, simatis, id);
      await demanderRestitution(t.app.db, simatis, id);
      await demarrerAttente(t.app.db, simatis, id);
      await enregistrer(id, LIEN_2);
      await finirAttente(t.app.db, simatis, id);
      await marquerDeckFinal(t.app.db, simatis, id, LIEN_2, true);
      const liens = (await relire(id)).restitutionLiens;
      expect(liens.filter((l) => l.finale).map((l) => l.lien)).toEqual([LIEN_2]);
    });

    it('un nouveau deck garde le drapeau final des anciens', async () => {
      const id = await deckPret('Finale Fictive C');
      await marquerDeckFinal(t.app.db, simatis, id, LIEN_1, true);
      await demarrerAttente(t.app.db, simatis, id);
      await finirAttente(t.app.db, simatis, id);
      await demanderRestitution(t.app.db, simatis, id);
      await demarrerAttente(t.app.db, simatis, id);
      await enregistrer(id, LIEN_2);
      const liens = (await relire(id)).restitutionLiens;
      expect(liens.find((l) => l.lien === LIEN_1)?.finale).toBe(true);
    });

    it('refuse un lien étranger au projet sans rien modifier', async () => {
      const id = await deckPret('Finale Fictive D');
      await expect(marquerDeckFinal(t.app.db, simatis, id, LIEN_2, true)).rejects.toBeInstanceOf(
        ChatIndisponible,
      );
      const relu = await relire(id);
      expect(relu.restitutionLiens.some((l) => l.finale)).toBe(false);
      expect(relu.demande).toBeNull();
    });

    it('garde la case cochée si Claude répond déjà, sans lancer de demande', async () => {
      const id = await deckPret('Finale Fictive E');
      await demanderExportRestitution(t.app.db, simatis, id);
      await demarrerAttente(t.app.db, simatis, id);
      const vue = await marquerDeckFinal(t.app.db, simatis, id, LIEN_1, true);
      expect(vue.demande).toBe('restitution_export');
      expect(vue.restitutionLiens[0]?.finale).toBe(true);
    });

    it('décocher ne lance rien', async () => {
      const id = await deckPret('Finale Fictive F');
      await marquerDeckFinal(t.app.db, simatis, id, LIEN_1, true);
      await demarrerAttente(t.app.db, simatis, id);
      await finirAttente(t.app.db, simatis, id);
      const vue = await marquerDeckFinal(t.app.db, simatis, id, LIEN_1, false);
      expect(vue.demande).toBeNull();
      expect(vue.restitutionLiens.some((l) => l.finale)).toBe(false);
    });

    it('refuse la capitalisation sans deck final', async () => {
      const id = await deckPret('Finale Fictive G');
      await expect(demanderReglesRestitution(t.app.db, simatis, id)).rejects.toBeInstanceOf(
        ChatIndisponible,
      );
    });

    // Instance à part : la permission ne se prononce que si un seul projet est en cours.
    it('pendant la capitalisation, seule la lecture d un artifact est permise', async () => {
      const instance = await createInstance(t.owner.db, {
        slug: 'simatis-restitution-regles',
        nom: 'SIMATIS',
        type: 'propre',
      });
      const p = await createProjet(t.app.db, instance, {
        nom: 'Finale Fictive H',
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
      await marquerDeckFinal(t.app.db, instance, p.id, LIEN_1, true);
      await demarrerAttente(t.app.db, instance, p.id);
      const decider = (outil: string, input: Record<string, unknown>) =>
        withInstance(t.app.db, instance.id, (tx) => autoriserSiRestitution(tx, outil, input));
      expect(await decider('Artifact', { action: 'read', url: LIEN_2 })).toMatchObject({
        behavior: 'allow',
      });
      for (const [outil, input] of [
        ['Artifact', { action: 'publish', url: LIEN_1 }],
        ['Artifact', { action: 'delete', url: LIEN_1 }],
        ['Edit', {}],
        ['Bash', {}],
      ] as const)
        expect(await decider(outil, { ...input })).toMatchObject({ behavior: 'deny' });
    });
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

    it('importe un deck construit hors de l OS : lien gardé sans fragment, export demandé', async () => {
      const id = await avecRapport('Import Fictif A');
      const envoye = await importerDeckRestitution(
        t.app.db,
        simatis,
        id,
        `  ${LIEN_1}#slide-abc123 `,
      );
      expect(envoye).toMatchObject({
        restitutionLien: LIEN_1,
        restitutionStatut: 'pret',
        demande: 'restitution_export',
      });
    });

    it('refuse un lien qui n est pas un artifact claude.ai', async () => {
      const id = await avecRapport('Import Fictif B');
      await expect(
        importerDeckRestitution(t.app.db, simatis, id, 'https://exemple.test/deck'),
      ).rejects.toBeInstanceOf(SupportInvalide);
      expect((await relire(id)).restitutionLien).toBeNull();
    });

    it('purge les diapositives après la présentation, le lien du deck reste', async () => {
      const id = await deckPret('Import Fictif C');
      await demanderExportRestitution(t.app.db, simatis, id);
      await demarrerAttente(t.app.db, simatis, id);
      await enregistrerDiapos(id);
      await finirAttente(t.app.db, simatis, id);
      expect((await relire(id)).aPptx).toBe(true);
      const apres = await purgerDiapositivesRestitution(t.app.db, simatis, id);
      expect(apres).toMatchObject({ aPptx: false, restitutionExportLe: null });
      expect(apres.restitutionLien).toBe(LIEN_1);
      await expect(diapositivesRestitutionDe(t.app.db, simatis, id)).rejects.toBeInstanceOf(
        ProjetIntrouvable,
      );
    });

    it('garde le PDF du deck, le rend tel quel, et la purge l efface', async () => {
      const id = await deckPret('Pdf Fictif A');
      const pdf = Buffer.from('%PDF-1.7\n% fictif\n').toString('base64');
      const apres = await enregistrerPdfDeck(t.app.db, simatis, id, {
        nom: 'deck.pdf',
        base64: pdf,
      });
      expect(apres.aPdfDeck).toBe(true);
      expect(apres).not.toHaveProperty('restitutionPdf');
      const { nom, contenu } = await pdfDeckDe(t.app.db, simatis, id);
      expect(nom).toBe('deck.pdf');
      expect(contenu.toString('base64')).toBe(pdf);
      const purge = await purgerDiapositivesRestitution(t.app.db, simatis, id);
      expect(purge.aPdfDeck).toBe(false);
      await expect(pdfDeckDe(t.app.db, simatis, id)).rejects.toBeInstanceOf(ProjetIntrouvable);
    });

    it('refuse un fichier qui n est pas un PDF', async () => {
      const id = await deckPret('Pdf Fictif B');
      await expect(
        enregistrerPdfDeck(t.app.db, simatis, id, {
          nom: 'deck.pdf',
          base64: Buffer.from('pas un pdf').toString('base64'),
        }),
      ).rejects.toBeInstanceOf(SupportInvalide);
      expect((await relire(id)).aPdfDeck).toBe(false);
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

    it('n a pas de diapositives à présenter avant un export', async () => {
      const id = await deckPret('Export Fictif H');
      await expect(diapositivesRestitutionDe(t.app.db, simatis, id)).rejects.toBeInstanceOf(
        ProjetIntrouvable,
      );
    });

    it('rend les dernières diapositives exportées pour la présentation dans l OS', async () => {
      const id = await deckPret('Export Fictif I');
      await demanderExportRestitution(t.app.db, simatis, id);
      await demarrerAttente(t.app.db, simatis, id);
      await enregistrerDiapos(id);
      await finirAttente(t.app.db, simatis, id);
      const { nom, diapositives } = await diapositivesRestitutionDe(t.app.db, simatis, id);
      expect(nom).toBe('Export Fictif I');
      expect(diapositives.length).toBeGreaterThan(0);
      expect(diapositives[0]).toHaveProperty('titre');
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
