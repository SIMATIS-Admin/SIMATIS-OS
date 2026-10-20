import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ChatIndisponible } from './chat.js';
import { createProjet, listProjets, updateProjet } from './service.js';
import { demanderRapport, rapportPret } from './rapport.js';

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
