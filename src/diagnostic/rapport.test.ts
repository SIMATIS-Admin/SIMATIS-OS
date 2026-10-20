import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ChatIndisponible, demarrerAttente } from './chat.js';
import { createProjet, listProjets, updateProjet } from './service.js';
import { autoriserSiRapport, demanderRapport, enregistrerRapport, rapportPret } from './rapport.js';
import { SupportInvalide } from './support.js';
import { withInstance } from '../db/context.js';

const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };

describe('Rapport : pré-requis', () => {
  it('refuse sans résultat saisi à l étape 2', () => {
    expect(rapportPret({ dims: null, revue: { statut: 'validée' } })).toEqual({
      ok: false,
      raison: "Saisissez d'abord le résultat à l'étape 2.",
    });
  });

  it('refuse sans revue validée à l étape 3', () => {
    expect(rapportPret({ dims, revue: { statut: 'brouillon' } })).toEqual({
      ok: false,
      raison: "Validez d'abord la revue à l'étape 3.",
    });
    expect(rapportPret({ dims, revue: null })).toEqual({
      ok: false,
      raison: "Validez d'abord la revue à l'étape 3.",
    });
  });

  it('accepte un résultat et une revue validée', () => {
    expect(rapportPret({ dims, revue: { statut: 'validée' } })).toEqual({ ok: true });
  });
});

describe('Demande de rapport', () => {
  let t: TestApp;
  let simatis: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-rapport',
      nom: 'SIMATIS',
      type: 'propre',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const relire = async (id: string) =>
    (await listProjets(t.app.db, simatis)).find((p) => p.id === id)!;

  const projetPret = async (nom: string) => {
    const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
    return updateProjet(t.app.db, simatis, p.id, {
      dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
      revue: { statut: 'validée' },
    });
  };

  it('refuse sans pré-requis et n écrit rien', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Rapport Fictif A',
      activite: 'services',
    });
    await expect(demanderRapport(t.app.db, simatis, p.id)).rejects.toThrow(
      "Saisissez d'abord le résultat à l'étape 2.",
    );
    const relu = await relire(p.id);
    expect(relu.demande).toBeNull();
    expect(relu.statutChat).toBe('repos');
    expect(relu.rapportLienStatut).toBe('aucun');
  });

  it('pose la demande à l étape 4 et passe le rapport en cours', async () => {
    const p = await projetPret('Rapport Fictif B');
    const envoye = await demanderRapport(t.app.db, simatis, p.id);
    expect(envoye.demande).toBe('rapport');
    expect(envoye.statutChat).toBe('attente_claude');
    expect(envoye.rapportLienStatut).toBe('en_cours');
    expect(envoye.conversation).toEqual([expect.objectContaining({ etape: 4, de: 'pilote' })]);
  });

  it('refuse un second clic pendant la rédaction', async () => {
    const p = await projetPret('Rapport Fictif C');
    await demanderRapport(t.app.db, simatis, p.id);
    await expect(demanderRapport(t.app.db, simatis, p.id)).rejects.toBeInstanceOf(ChatIndisponible);
    expect((await relire(p.id)).conversation).toHaveLength(1);
  });
});

describe('Enregistrement du rapport', () => {
  let t: TestApp;
  let simatis: Instance;
  const LIEN_1 = 'https://claude.ai/artifact/RapportFictif0001';
  const LIEN_2 = 'https://claude.ai/artifact/RapportFictif0002';

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-rapport-lien',
      nom: 'SIMATIS',
      type: 'propre',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const relire = async (id: string) =>
    (await listProjets(t.app.db, simatis)).find((p) => p.id === id)!;

  // Projet dont le runner a pris la demande de rapport (statut « en cours »).
  const enCours = async (instance: Instance, nom: string) => {
    const p = await createProjet(t.app.db, instance, { nom, activite: 'services' });
    await updateProjet(t.app.db, instance, p.id, {
      dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
      revue: { statut: 'validée' },
    });
    await demanderRapport(t.app.db, instance, p.id);
    await demarrerAttente(t.app.db, instance, p.id);
    return p.id;
  };

  const enregistrer = (id: string, lien: string) =>
    withInstance(t.app.db, simatis.id, (tx) => enregistrerRapport(tx, id, lien));

  it('refuse un lien hors claude.ai et ne change rien', async () => {
    const id = await enCours(simatis, 'Rapport Fictif D');
    await expect(
      enregistrer(id, 'https://example.com/artifact/RapportFictif0001'),
    ).rejects.toBeInstanceOf(SupportInvalide);
    const relu = await relire(id);
    expect(relu.rapportLien).toBeNull();
    expect(relu.rapportLienStatut).toBe('en_cours');
    expect(relu.rapportLiens).toEqual([]);
  });

  it('pose le lien, passe à prêt, et garde l ancien lien dans l historique', async () => {
    const id = await enCours(simatis, 'Rapport Fictif E');
    await enregistrer(id, LIEN_1);
    let relu = await relire(id);
    expect(relu.rapportLien).toBe(LIEN_1);
    expect(relu.rapportLienStatut).toBe('pret');
    await enregistrer(id, LIEN_2);
    relu = await relire(id);
    expect(relu.rapportLien).toBe(LIEN_2);
    expect(relu.rapportLiens.map((r) => r.lien)).toEqual([LIEN_2, LIEN_1]);
  });

  it('autorise la création et la publication sur le seul rapport du projet', async () => {
    const instance = await createInstance(t.owner.db, {
      slug: 'simatis-rapport-auto',
      nom: 'SIMATIS',
      type: 'propre',
    });
    const id = await enCours(instance, 'Rapport Fictif F');
    await withInstance(t.app.db, instance.id, (tx) => enregistrerRapport(tx, id, LIEN_1));
    const decider = (input: Record<string, unknown>) =>
      withInstance(t.app.db, instance.id, (tx) => autoriserSiRapport(tx, 'Artifact', input));
    expect(await decider({ action: 'publish', url: LIEN_1 })).toMatchObject({ behavior: 'allow' });
    expect(await decider({ action: 'publish', type_url: 'type-fictif' })).toMatchObject({
      behavior: 'allow',
    });
    expect(await decider({ action: 'read', url: LIEN_2 })).toMatchObject({ behavior: 'allow' });
    expect(await decider({ action: 'publish', url: LIEN_2 })).toMatchObject({ behavior: 'deny' });
    expect(await decider({ action: 'delete', url: LIEN_1 })).toMatchObject({ behavior: 'deny' });
  });
});
