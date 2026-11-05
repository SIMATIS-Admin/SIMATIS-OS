import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { eq } from 'drizzle-orm';
import { diagnosticProjets } from './schema.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  attentesClaude,
  ChatIndisponible,
  demarrerAttente,
  finirAttente,
  repondreClaude,
} from './chat.js';
import {
  DEBUT_MESSAGE_REGLES_SUPPORT,
  capitaliserSiSupportFinal,
  demanderCapitalisationSupport,
  finDeDemande,
} from './support.js';
import { createProjet, DiagnosticIndisponible, listProjets, updateProjet } from './service.js';
import {
  autoriserOutil,
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
    await expect(enregistrer(p.id, { lien: LIEN })).rejects.toBeInstanceOf(SupportInvalide);
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

  it('ne laisse publier que sur le deck du projet en cours, jamais sur le modèle', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Support Fictif F', activite: 'autre' });
    await demanderSupport(t.app.db, simatis, p.id, 'preparer_support');
    await demarrerAttente(t.app.db, simatis, p.id);
    const decide = (outil: string, input: Record<string, unknown>) =>
      withInstance(t.app.db, simatis.id, (tx) => autoriserOutil(tx, outil, input));

    expect(
      await decide('Artifact', { action: 'read', url: 'https://claude.ai/artifact/Modele01' }),
    ).toMatchObject({ behavior: 'allow' });
    expect(
      await decide('Artifact', { type_url: 'https://claude.ai/artifact/TypeSlides', title: 'x' }),
    ).toMatchObject({ behavior: 'allow' });
    // Avant l'enregistrement du deck, aucune publication sur une url existante.
    expect(await decide('Artifact', { url: LIEN, file_path: 'deck.json' })).toMatchObject({
      behavior: 'deny',
    });
    await enregistrer(p.id, { lien: LIEN });
    expect(await decide('Artifact', { url: LIEN, file_path: 'deck.json' })).toMatchObject({
      behavior: 'allow',
    });
    expect(
      await decide('Artifact', { url: 'https://claude.ai/artifact/Modele01', file_path: 'x' }),
    ).toMatchObject({ behavior: 'deny' });
    expect(await decide('Artifact', { action: 'delete', url: LIEN })).toMatchObject({
      behavior: 'deny',
    });
    expect(await decide('Bash', { command: 'ls' })).toMatchObject({ behavior: 'deny' });
    await finirAttente(t.app.db, simatis, p.id);
  });

  describe('capitalisation du support final', () => {
    const projetFinal = async (nom: string, final = true) => {
      const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
      await withInstance(t.app.db, simatis.id, (tx) =>
        tx
          .update(diagnosticProjets)
          .set({
            supportLien: 'https://claude.ai/artifact/AbCdEfGh12',
            supportStatut: final ? 'final' : 'pret',
            supportTexte: final ? [{ titre: 'T', texte: 'X', notes: 'N' }] : null,
          })
          .where(eq(diagnosticProjets.id, p.id)),
      );
      return p.id;
    };

    it('lance la demande de règles sur un support final, à l étape 1', async () => {
      const id = await projetFinal('Capi support A');
      await demanderCapitalisationSupport(t.app.db, simatis, id);
      const p = await relire(id);
      expect(p.demande).toBe('regles_support');
      expect(p.conversation.at(-1)).toMatchObject({
        de: 'pilote',
        etape: 1,
        texte: `${DEBUT_MESSAGE_REGLES_SUPPORT}.`,
      });
    });

    it('refuse sans support final, et pendant que Claude répond', async () => {
      const brouillon = await projetFinal('Capi support B', false);
      await expect(demanderCapitalisationSupport(t.app.db, simatis, brouillon)).rejects.toThrow(
        ChatIndisponible,
      );
      const occupe = await projetFinal('Capi support C');
      await demanderCapitalisationSupport(t.app.db, simatis, occupe);
      await expect(demanderCapitalisationSupport(t.app.db, simatis, occupe)).rejects.toThrow(
        ChatIndisponible,
      );
    });

    it('capitaliserSiSupportFinal : seulement après une demande support_final', async () => {
      const apres = await projetFinal('Capi support D');
      await capitaliserSiSupportFinal(t.app.db, simatis, apres, 'support_final');
      expect((await relire(apres)).demande).toBe('regles_support');
      for (const autre of ['preparer_support', 'rapport', null] as const) {
        const id = await projetFinal(`Capi support E ${autre}`);
        await capitaliserSiSupportFinal(t.app.db, simatis, id, autre);
        expect((await relire(id)).demande).toBeNull();
      }
    });

    it('capitaliserSiSupportFinal : rien si le support n est pas final, muet si Claude répond déjà', async () => {
      const brouillon = await projetFinal('Capi support F', false);
      await capitaliserSiSupportFinal(t.app.db, simatis, brouillon, 'support_final');
      expect((await relire(brouillon)).demande).toBeNull();
      const occupe = await projetFinal('Capi support G');
      await demanderCapitalisationSupport(t.app.db, simatis, occupe);
      await expect(
        capitaliserSiSupportFinal(t.app.db, simatis, occupe, 'support_final'),
      ).resolves.toBeUndefined();
    });

    it('finDeDemande : après un « support final » sans erreur, enchaîne la capitalisation', async () => {
      const id = await projetFinal('Capi support H');
      await withInstance(t.app.db, simatis.id, (tx) =>
        tx
          .update(diagnosticProjets)
          .set({ demande: 'support_final', statutChat: 'en_cours' })
          .where(eq(diagnosticProjets.id, id)),
      );
      await finDeDemande(t.app.db, simatis, id);
      expect((await relire(id)).demande).toBe('regles_support');
    });

    it('finDeDemande : avec une erreur, ne lance rien', async () => {
      const id = await projetFinal('Capi support I');
      await withInstance(t.app.db, simatis.id, (tx) =>
        tx
          .update(diagnosticProjets)
          .set({ demande: 'support_final', statutChat: 'en_cours' })
          .where(eq(diagnosticProjets.id, id)),
      );
      await finDeDemande(t.app.db, simatis, id, 'Claude s’est arrêté.');
      const p = await relire(id);
      expect(p.demande).toBeNull();
      expect(p.statutChat).toBe('repos');
    });
  });
});
