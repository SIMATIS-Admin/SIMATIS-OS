import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  attentesClaude,
  ChatIndisponible,
  demarrerAttente,
  finirAttente,
  repondreClaude,
} from './chat.js';
import { createProjet, DiagnosticIndisponible, listProjets, updateProjet } from './service.js';
import {
  demanderSupport,
  enregistrerSupport,
  logoDe,
  rouvrirSupport,
  SupportInvalide,
} from './support.js';

const LIEN = 'https://claude.ai/artifact/DeckFictif0001';
const DIAPOS = [
  { titre: 'Couverture', texte: 'Entreprise fictive', notes: 'Notes fictives' },
  { titre: 'Contexte', texte: 'Faits fictifs', notes: '' },
];
// PNG d'un pixel.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe("Diagnostic : support d'ouverture", () => {
  let t: TestApp;
  let simatis: Instance;
  let mandat: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-support',
      nom: 'SIMATIS',
      type: 'propre',
    });
    mandat = await createInstance(t.owner.db, {
      slug: 'mandat-support',
      nom: 'Mandat',
      type: 'mandat',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const relire = async (id: string) =>
    (await listProjets(t.app.db, simatis)).find((p) => p.id === id)!;
  const enregistrer = (id: string, input: Parameters<typeof enregistrerSupport>[2]) =>
    withInstance(t.app.db, simatis.id, (tx) => enregistrerSupport(tx, id, input));

  it('garde le formulaire et le logo, sans renvoyer le logo avec la liste', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Support Fictif A', activite: 'autre' });
    const maj = await updateProjet(t.app.db, simatis, p.id, {
      ditParDirigeant: 'Ambition fictive',
      hypotheses: 'Hypothèse fictive',
      logo: { nom: 'logo.png', base64: PNG },
    });
    expect(maj).toMatchObject({ ditParDirigeant: 'Ambition fictive', aLogo: true });
    expect(maj).not.toHaveProperty('logo');
    expect(await logoDe(t.app.db, simatis, p.id)).toMatchObject({ type: 'image/png' });
  });

  it('préparer le support : demande au runner, à l étape 1, avec le logo', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Support Fictif B', activite: 'autre' });
    await updateProjet(t.app.db, simatis, p.id, {
      etape: 2,
      logo: { nom: 'logo.png', base64: PNG },
    });
    const vu = await demanderSupport(t.app.db, simatis, p.id, 'preparer_support');
    expect(vu).toMatchObject({
      statutChat: 'attente_claude',
      demande: 'preparer_support',
      supportStatut: 'preparation',
    });
    expect(vu.conversation.at(-1)).toMatchObject({ etape: 1, de: 'pilote' });

    const attente = (await attentesClaude(t.app.db)).find((a) => a.id === p.id)!;
    expect(attente).toMatchObject({ etapeMessage: 1, demande: 'preparer_support' });
    expect(attente.logo).toEqual({ nom: 'logo.png', base64: PNG });
  });

  it('enregistre le lien du deck, puis archive son texte sur « Support final »', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Support Fictif C', activite: 'autre' });
    await demanderSupport(t.app.db, simatis, p.id, 'preparer_support');
    await demarrerAttente(t.app.db, simatis, p.id);
    await enregistrer(p.id, { lien: LIEN });
    // Le texte final ne s'archive pas pendant une préparation.
    await expect(enregistrer(p.id, { diapositives: DIAPOS })).rejects.toBeInstanceOf(
      SupportInvalide,
    );
    await withInstance(t.app.db, simatis.id, (tx) => repondreClaude(tx, p.id, 'Deck prêt.'));
    await finirAttente(t.app.db, simatis, p.id);
    expect(await relire(p.id)).toMatchObject({
      supportStatut: 'pret',
      supportLien: LIEN,
      demande: null,
    });

    await demanderSupport(t.app.db, simatis, p.id, 'support_final');
    await demarrerAttente(t.app.db, simatis, p.id);
    await enregistrer(p.id, { diapositives: DIAPOS });
    await finirAttente(t.app.db, simatis, p.id);
    const final = await relire(p.id);
    expect(final).toMatchObject({ supportStatut: 'final', supportTexte: DIAPOS });
    expect(final.supportFinalLe).toBeInstanceOf(Date);

    await expect(
      demanderSupport(t.app.db, simatis, p.id, 'preparer_support'),
    ).rejects.toBeInstanceOf(ChatIndisponible);
    expect(await rouvrirSupport(t.app.db, simatis, p.id)).toMatchObject({ supportStatut: 'pret' });
    await expect(rouvrirSupport(t.app.db, simatis, p.id)).rejects.toBeInstanceOf(ChatIndisponible);
  });

  it('sans deck enregistré, la préparation redevient possible et le pilote est averti', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Support Fictif D', activite: 'autre' });
    await demanderSupport(t.app.db, simatis, p.id, 'preparer_support');
    await demarrerAttente(t.app.db, simatis, p.id);
    await finirAttente(t.app.db, simatis, p.id, 'Claude s’est arrêté.');
    const relu = await relire(p.id);
    expect(relu).toMatchObject({ supportStatut: 'aucun', demande: null, statutChat: 'repos' });
    expect(relu.conversation.at(-1)).toMatchObject({ etape: 1, erreur: true });
  });

  it('refuse le support final sans deck, et tout support pour un mandat', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Support Fictif E', activite: 'autre' });
    await expect(demanderSupport(t.app.db, simatis, p.id, 'support_final')).rejects.toBeInstanceOf(
      ChatIndisponible,
    );
    await expect(
      demanderSupport(t.app.db, mandat, p.id, 'preparer_support'),
    ).rejects.toBeInstanceOf(DiagnosticIndisponible);
  });
});
