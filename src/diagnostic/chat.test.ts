import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  attentesClaude,
  ChatIndisponible,
  demarrerAttente,
  envoyerMessage,
  finirAttente,
  REPONSE_ABSENTE,
  repondreClaude,
} from './chat.js';
import { createProjet, DiagnosticIndisponible, listProjets } from './service.js';

describe('Chat du diagnostic', () => {
  let t: TestApp;
  let simatis: Instance;
  let mandat: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-chat',
      nom: 'SIMATIS',
      type: 'propre',
    });
    mandat = await createInstance(t.owner.db, {
      slug: 'mandat-chat',
      nom: 'Mandat',
      type: 'mandat',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const statut = async (id: string) =>
    (await listProjets(t.app.db, simatis)).find((p) => p.id === id)!;

  it('garde le message du pilote, puis refuse un second message avant la réponse', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Chat Fictif A', activite: 'services' });
    const envoye = await envoyerMessage(t.app.db, simatis, p.id, '  Quelle question poser ?  ');
    expect(envoye.statutChat).toBe('attente_claude');
    expect(envoye.conversation).toEqual([
      expect.objectContaining({ etape: 1, de: 'pilote', texte: 'Quelle question poser ?' }),
    ]);
    await expect(envoyerMessage(t.app.db, simatis, p.id, 'Encore')).rejects.toBeInstanceOf(
      ChatIndisponible,
    );
  });

  it('range la réponse de Claude à l étape du message et rend le chat disponible', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Chat Fictif B', activite: 'batiment' });
    await envoyerMessage(t.app.db, simatis, p.id, 'Question fictive');
    await withInstance(t.app.db, simatis.id, (tx) => repondreClaude(tx, p.id, 'Réponse fictive.'));
    const relu = await statut(p.id);
    expect(relu.statutChat).toBe('repos');
    expect(relu.conversation.at(-1)).toEqual(
      expect.objectContaining({ etape: 1, de: 'claude', texte: 'Réponse fictive.' }),
    );
    await expect(envoyerMessage(t.app.db, simatis, p.id, 'Suite')).resolves.toBeDefined();
  });

  it('le runner prend la demande, puis une absence de réponse revient au pilote', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Chat Fictif C', activite: 'autre' });
    await envoyerMessage(t.app.db, simatis, p.id, 'Question fictive');
    expect((await attentesClaude(t.app.db)).map((a) => a.id)).toContain(p.id);

    const pris = await demarrerAttente(t.app.db, simatis, p.id);
    expect(pris.statutChat).toBe('en_cours');
    await expect(demarrerAttente(t.app.db, simatis, p.id)).rejects.toBeInstanceOf(ChatIndisponible);

    await finirAttente(t.app.db, simatis, p.id);
    const relu = await statut(p.id);
    expect(relu.statutChat).toBe('repos');
    expect(relu.conversation.at(-1)).toEqual(
      expect.objectContaining({ de: 'claude', erreur: true, texte: REPONSE_ABSENTE }),
    );
  });

  it('refuse le chat d un mandat', async () => {
    await expect(envoyerMessage(t.app.db, mandat, 'x', 'Bonjour')).rejects.toBeInstanceOf(
      DiagnosticIndisponible,
    );
  });
});
