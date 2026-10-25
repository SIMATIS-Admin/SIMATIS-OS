import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ChatIndisponible, demarrerAttente, finirAttente } from './chat.js';
import { createProjet, listProjets, rapportDe, updateProjet } from './service.js';
import { contenuRapportFictif } from './fixtures/rapport-fictif.js';
import { demanderRapport, enregistrerRapport, rapportPret } from './rapport.js';
import { SupportInvalide } from './support.js';
import { withInstance } from '../db/context.js';

const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };

describe('Rapport : pré-requis', () => {
  it('refuse sans résultat saisi à l étape 2', () => {
    expect(rapportPret({ dims: null })).toEqual({
      ok: false,
      raison: "Saisissez d'abord le résultat à l'étape 2.",
    });
  });

  it('accepte dès que le résultat est saisi, revue validée ou non', () => {
    expect(rapportPret({ dims })).toEqual({ ok: true });
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

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-rapport-word',
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
  const enCours = async (nom: string) => {
    const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
    await updateProjet(t.app.db, simatis, p.id, {
      dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
    });
    await demanderRapport(t.app.db, simatis, p.id);
    await demarrerAttente(t.app.db, simatis, p.id);
    return p.id;
  };

  const enregistrer = (id: string, contenu: unknown = contenuRapportFictif) =>
    withInstance(t.app.db, simatis.id, (tx) => enregistrerRapport(tx, id, contenu as never));

  it('met le rapport en page en Word, le garde dans le projet et passe à prêt', async () => {
    const id = await enCours('Rapport Fictif E');
    await enregistrer(id);
    const relu = await relire(id);
    expect(relu.aRapport).toBe(true);
    expect(relu.rapportNom).toBe('Rapport Diagnostic Endurance - Atelier Fictif Nord.docx');
    expect(relu.rapportLienStatut).toBe('pret');
    const fichier = await rapportDe(t.app.db, simatis, id);
    expect(fichier.contenu.subarray(0, 2).toString()).toBe('PK');
  });

  it('refuse un contenu invalide et ne change rien', async () => {
    const id = await enCours('Rapport Fictif D');
    await expect(enregistrer(id, { entreprise: 'X' })).rejects.toBeInstanceOf(SupportInvalide);
    const relu = await relire(id);
    expect(relu.aRapport).toBe(false);
    expect(relu.rapportLienStatut).toBe('en_cours');
  });

  it('refuse sans demande de rapport en cours', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Rapport Fictif F',
      activite: 'services',
    });
    await expect(enregistrer(p.id)).rejects.toBeInstanceOf(SupportInvalide);
  });

  it('scénario complet : un second rapport remplace le premier', async () => {
    const id = await enCours('Rapport Fictif I');
    await enregistrer(id);
    await finirAttente(t.app.db, simatis, id);
    expect(await relire(id)).toMatchObject({ rapportLienStatut: 'pret', demande: null });

    const second = await demanderRapport(t.app.db, simatis, id);
    expect(second).toMatchObject({ demande: 'rapport', rapportLienStatut: 'en_cours' });
    await demarrerAttente(t.app.db, simatis, id);
    await enregistrer(id, { ...contenuRapportFictif, entreprise: 'Atelier Fictif Sud' });
    await finirAttente(t.app.db, simatis, id);
    const relu = await relire(id);
    expect(relu.rapportNom).toBe('Rapport Diagnostic Endurance - Atelier Fictif Sud.docx');
    expect(relu.rapportLienStatut).toBe('pret');
  });
});
