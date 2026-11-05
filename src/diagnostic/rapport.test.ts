import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ChatIndisponible, demarrerAttente, finirAttente } from './chat.js';
import { createProjet, listProjets, rapportDe, updateProjet } from './service.js';
import { contenuRapportFictif } from './fixtures/rapport-fictif.js';
import {
  DEBUT_MESSAGE_ANNULATION,
  DEBUT_MESSAGE_REGLES,
  demanderAnnulationRegle,
  demanderCapitalisationRapport,
  demanderRapport,
  enregistrerRapport,
  importerRapport,
  marquerVersionFinale,
  rapportPret,
  versionDuNom,
} from './rapport.js';
import { eq, sql } from 'drizzle-orm';
import { diagnosticProjets } from './schema.js';
import { ajouterChangementsRegles, listerJournalRegles } from './regles.js';
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
    expect(relu.rapportNom).toBe('Rapport Diagnostic Endurance - Atelier Fictif Nord - v1.docx');
    expect(relu.rapportVersions).toEqual([expect.objectContaining({ version: 1 })]);
    expect(relu.rapportVersions[0]).not.toHaveProperty('contenu');
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

  it('scénario complet : chaque production crée une version, les précédentes se téléchargent', async () => {
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
    expect(relu.rapportNom).toBe('Rapport Diagnostic Endurance - Atelier Fictif Sud - v2.docx');
    expect(relu.rapportVersions.map((v) => v.version)).toEqual([1, 2]);
    expect(relu.rapportLienStatut).toBe('pret');
    // La version 1 se régénère depuis son contenu ; la dernière est le Word enregistré.
    const v1 = await rapportDe(t.app.db, simatis, id, 1);
    expect(v1.nom).toBe('Rapport Diagnostic Endurance - Atelier Fictif Nord - v1.docx');
    expect(v1.contenu.subarray(0, 2).toString()).toBe('PK');
    expect((await rapportDe(t.app.db, simatis, id)).nom).toContain('Atelier Fictif Sud - v2');
    await expect(rapportDe(t.app.db, simatis, id, 9)).rejects.toThrow(
      'Version du rapport introuvable',
    );
  });

  it('un Word importé compte pour la version 1 : la première production est la version 2', async () => {
    const id = await enCours('Rapport Fictif J');
    await t.owner.db.execute(
      sql`update diagnostic_projets set rapport = 'UEs=', rapport_nom = 'importe.docx' where id = ${id}`,
    );
    await enregistrer(id);
    const relu = await relire(id);
    expect(relu.rapportNom).toBe('Rapport Diagnostic Endurance - Atelier Fictif Nord - v2.docx');
    expect(relu.rapportVersions.map((v) => v.version)).toEqual([2]);
  });

  it('la demande de production annonce la version suivante dans le chat', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Rapport Fictif K',
      activite: 'services',
    });
    await updateProjet(t.app.db, simatis, p.id, {
      dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
    });
    const envoye = await demanderRapport(t.app.db, simatis, p.id);
    expect(envoye.conversation.at(-1)?.texte).toBe('Produire le rapport version 1.');
  });

  it('lit le numéro de version dans le nom du Word', () => {
    expect(versionDuNom(null)).toBe(0);
    expect(versionDuNom('importe.docx')).toBe(1);
    expect(versionDuNom('Rapport Diagnostic Endurance - Atelier Fictif - v3.docx')).toBe(3);
    // Le « (1) » que le navigateur ajoute à un fichier enregistré deux fois ne cache pas le numéro.
    expect(versionDuNom('Rapport_-_Atelier_Fictif_-_v3 (1).docx')).toBe(3);
    expect(versionDuNom('Rapport - V12.DOCX')).toBe(12);
  });

  it('un Word v3 importé annonce la version 4, pas la 2', async () => {
    const id = await enCours('Rapport Fictif L');
    await t.owner.db.execute(
      sql`update diagnostic_projets set rapport = 'UEs=', rapport_nom = 'Rapport Fictif - v3.docx', rapport_lien_statut = 'aucun', demande = null, statut_chat = 'repos' where id = ${id}`,
    );
    const envoye = await demanderRapport(t.app.db, simatis, id);
    expect(envoye.conversation.at(-1)?.texte).toBe('Produire le rapport version 4.');
  });

  const projetAvecResultat = async (nom: string) => {
    const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
    return updateProjet(t.app.db, simatis, p.id, { dims });
  };

  it('importe un Word retravaillé : il remplace le Word affiché et devient téléchargeable', async () => {
    const p = await projetAvecResultat('Rapport Fictif M');
    const word = Buffer.from('PK\u0003\u0004contenu fictif').toString('base64');
    const vue = await importerRapport(t.app.db, simatis, p.id, {
      nom: 'Rapport Fictif M - v4.docx',
      base64: word,
    });
    expect(vue.rapportNom).toBe('Rapport Fictif M - v4.docx');
    expect(vue.aRapport).toBe(true);
    expect(vue.rapportLienStatut).toBe('pret');
    const telecharge = await rapportDe(t.app.db, simatis, p.id);
    expect(telecharge.nom).toBe('Rapport Fictif M - v4.docx');
    expect(telecharge.contenu.subarray(0, 2).toString()).toBe('PK');
  });

  it('refuse un fichier qui n est pas un Word et n écrit rien', async () => {
    const p = await projetAvecResultat('Rapport Fictif N');
    await expect(
      importerRapport(t.app.db, simatis, p.id, {
        nom: 'notes.docx',
        base64: Buffer.from('pas un zip').toString('base64'),
      }),
    ).rejects.toThrow(ChatIndisponible);
    await expect(
      importerRapport(t.app.db, simatis, p.id, {
        nom: 'rapport.pdf',
        base64: Buffer.from('PKxx').toString('base64'),
      }),
    ).rejects.toThrow('Word');
    expect((await relire(p.id)).aRapport).toBe(false);
  });
});

describe('Version finale du rapport', () => {
  let t: TestApp;
  let simatis: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-rapport-finale',
      nom: 'SIMATIS',
      type: 'propre',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const doc = (n: number) => `https://docs.google.com/document/d/doc-${n}/edit`;
  const artifact = 'https://claude.ai/artifact/abc';

  // Projet fictif dont le rapport a déjà trois liens : deux Google Docs de la version 3 (double
  // envoi), un Doc de la version 4 et un ancien artifact.
  const projetAvecLiens = async (nom: string, statut: 'pret' | 'en_cours' = 'pret') => {
    const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
    await withInstance(t.app.db, simatis.id, (tx) =>
      tx
        .update(diagnosticProjets)
        .set({
          rapportLienStatut: statut,
          rapportLiens: [
            { lien: doc(4), le: '2026-10-29T10:00:00.000Z', version: 4 },
            { lien: doc(3), le: '2026-10-28T14:23:00.000Z', version: 3 },
            { lien: doc(2), le: '2026-10-28T14:21:00.000Z', version: 3 },
            { lien: artifact, le: '2026-10-22T15:39:00.000Z' },
          ],
        })
        .where(eq(diagnosticProjets.id, p.id)),
    );
    return p.id;
  };

  const finales = async (id: string) =>
    (await listProjets(t.app.db, simatis))
      .find((p) => p.id === id)!
      .rapportLiens.filter((l) => l.finale)
      .map((l) => l.lien);

  it('cocher un Google Doc le rend final', async () => {
    const id = await projetAvecLiens('Finale Fictif A');
    const vue = await marquerVersionFinale(t.app.db, simatis, id, doc(4), true);
    expect(vue.rapportLiens.find((l) => l.lien === doc(4))?.finale).toBe(true);
  });

  it('une seule finale par projet : la nouvelle remplace la précédente', async () => {
    const id = await projetAvecLiens('Finale Fictif B');
    await marquerVersionFinale(t.app.db, simatis, id, doc(4), true);
    await marquerVersionFinale(t.app.db, simatis, id, doc(3), true);
    expect(await finales(id)).toEqual([doc(3)]);
  });

  it('deux entrées de même version : cocher l une laisse l autre intacte', async () => {
    const id = await projetAvecLiens('Finale Fictif C');
    await marquerVersionFinale(t.app.db, simatis, id, doc(2), true);
    expect(await finales(id)).toEqual([doc(2)]);
  });

  it('décocher retire la finale', async () => {
    const id = await projetAvecLiens('Finale Fictif D');
    await marquerVersionFinale(t.app.db, simatis, id, doc(4), true);
    await marquerVersionFinale(t.app.db, simatis, id, doc(4), false);
    expect(await finales(id)).toEqual([]);
  });

  it('refuse un lien artifact, un lien étranger au projet, et une production en cours', async () => {
    const id = await projetAvecLiens('Finale Fictif E');
    await expect(marquerVersionFinale(t.app.db, simatis, id, artifact, true)).rejects.toThrow(
      ChatIndisponible,
    );
    await expect(marquerVersionFinale(t.app.db, simatis, id, doc(99), true)).rejects.toThrow(
      ChatIndisponible,
    );
    const enCours = await projetAvecLiens('Finale Fictif F', 'en_cours');
    await expect(marquerVersionFinale(t.app.db, simatis, enCours, doc(4), true)).rejects.toThrow(
      ChatIndisponible,
    );
    expect(await finales(id)).toEqual([]);
    expect(await finales(enCours)).toEqual([]);
  });

  describe('capitalisation à la version finale', () => {
    const relire = async (id: string) =>
      (await listProjets(t.app.db, simatis)).find((p) => p.id === id)!;

    it('cocher une finale lance la demande de règles', async () => {
      const id = await projetAvecLiens('Capitalisation Fictif A');
      await marquerVersionFinale(t.app.db, simatis, id, doc(4), true);
      const p = await relire(id);
      expect(p.demande).toBe('regles_rapport');
      expect(p.statutChat).toBe('attente_claude');
      expect(p.conversation.at(-1)).toMatchObject({
        de: 'pilote',
        etape: 4,
        texte: `${DEBUT_MESSAGE_REGLES} version 4.`,
      });
    });

    it('décocher ne lance rien', async () => {
      const id = await projetAvecLiens('Capitalisation Fictif B');
      await marquerVersionFinale(t.app.db, simatis, id, doc(4), false);
      expect((await relire(id)).demande).toBeNull();
    });

    it('cocher pendant que Claude répond garde la finale sans erreur', async () => {
      const id = await projetAvecLiens('Capitalisation Fictif C');
      await withInstance(t.app.db, simatis.id, (tx) =>
        tx
          .update(diagnosticProjets)
          .set({ statutChat: 'attente_claude' })
          .where(eq(diagnosticProjets.id, id)),
      );
      await marquerVersionFinale(t.app.db, simatis, id, doc(4), true);
      expect(await finales(id)).toEqual([doc(4)]);
      expect((await relire(id)).demande).toBeNull();
    });

    it('la relance à la main exige une version finale', async () => {
      const id = await projetAvecLiens('Capitalisation Fictif D');
      await expect(demanderCapitalisationRapport(t.app.db, simatis, id)).rejects.toThrow(
        ChatIndisponible,
      );
      await withInstance(t.app.db, simatis.id, (tx) =>
        tx
          .update(diagnosticProjets)
          .set({
            rapportLiens: [
              { lien: doc(4), le: '2026-10-29T10:00:00.000Z', version: 4, finale: true },
            ],
          })
          .where(eq(diagnosticProjets.id, id)),
      );
      await demanderCapitalisationRapport(t.app.db, simatis, id);
      expect((await relire(id)).demande).toBe('regles_rapport');
    });

    it('demande d annulation : lance la demande, refuse une entrée déjà annulée ou inconnue', async () => {
      const id = await projetAvecLiens('Capitalisation Fictif E');
      await withInstance(t.app.db, simatis.id, (tx) =>
        ajouterChangementsRegles(tx, id, 'version finale 4', [
          {
            fiche: 'rapport',
            action: 'ajoutée',
            libelle: 'Règle fictive',
            avant: null,
            apres: 'R',
          },
        ]),
      );
      const [entree] = await listerJournalRegles(t.app.db, simatis, 1);
      await demanderAnnulationRegle(t.app.db, simatis, id, entree!.id);
      const p = await relire(id);
      expect(p.demande).toBe('regles_annuler');
      expect(p.conversation.at(-1)?.texte).toBe(`${DEBUT_MESSAGE_ANNULATION} ${entree!.id}.`);
      await expect(
        demanderAnnulationRegle(t.app.db, simatis, id, '00000000-0000-4000-8000-000000000099'),
      ).rejects.toThrow(ChatIndisponible);
    });
  });
});
