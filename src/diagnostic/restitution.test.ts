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
  demanderRestitution,
  enregistrerRestitution,
  restitutionPrete,
} from './restitution.js';
import { createProjet, listProjets, updateProjet } from './service.js';
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
});
