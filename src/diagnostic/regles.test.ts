import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  ajouterChangementsRegles,
  enregistrerReglesRapport,
  listerJournalRegles,
  marquerReglesAnnulee,
  type ChangementRegle,
} from './regles.js';
import { diagnosticProjets, type Demande } from './schema.js';
import { SupportInvalide } from './support.js';
import { createProjet } from './service.js';

const regle = (
  libelle: string,
  action: ChangementRegle['action'] = 'ajoutée',
): ChangementRegle => ({
  fiche: 'rapport',
  action,
  libelle,
  avant: null,
  apres: `Règle fictive : ${libelle}`,
});

describe('Journal des règles de rédaction', () => {
  let t: TestApp;
  let simatis: Instance;
  let autre: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-regles',
      nom: 'S',
      type: 'propre',
    });
    autre = await createInstance(t.owner.db, { slug: 'autre-regles', nom: 'A', type: 'propre' });
  });

  afterAll(async () => {
    await t.drop();
  });

  const ajouter = (instance: Instance, projetId: string, changements: ChangementRegle[]) =>
    withInstance(t.app.db, instance.id, (tx) =>
      ajouterChangementsRegles(tx, projetId, 'version finale 4', changements),
    );

  it('liste les changements du plus récent au plus ancien, actifs au départ', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Journal A', activite: 'services' });
    await ajouter(simatis, p.id, [regle('Première règle fictive')]);
    await ajouter(simatis, p.id, [regle('Seconde règle fictive', 'durcie')]);
    const liste = await listerJournalRegles(t.app.db, simatis);
    expect(liste.map((e) => e.libelle)).toEqual([
      'Seconde règle fictive',
      'Première règle fictive',
    ]);
    expect(liste[0]).toMatchObject({
      statut: 'actif',
      action: 'durcie',
      fiche: 'rapport',
      origine: 'version finale 4',
      projetId: p.id,
    });
  });

  it('respecte la limite demandée', async () => {
    const liste = await listerJournalRegles(t.app.db, simatis, 1);
    expect(liste).toHaveLength(1);
  });

  it('isole les instances', async () => {
    const p = await createProjet(t.app.db, autre, { nom: 'Journal B', activite: 'services' });
    await ajouter(autre, p.id, [regle('Règle de l autre instance')]);
    const liste = await listerJournalRegles(t.app.db, simatis);
    expect(liste.map((e) => e.libelle)).not.toContain('Règle de l autre instance');
  });

  it('garde les entrées lisibles quand le projet est supprimé', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Journal C', activite: 'services' });
    await ajouter(simatis, p.id, [regle('Règle d un projet supprimé')]);
    await withInstance(t.app.db, simatis.id, (tx) =>
      tx.delete(diagnosticProjets).where(eq(diagnosticProjets.id, p.id)),
    );
    const liste = await listerJournalRegles(t.app.db, simatis);
    expect(liste.map((e) => e.libelle)).toContain('Règle d un projet supprimé');
  });

  it('annuler passe l entrée à annulée et en ajoute une nouvelle', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Journal D', activite: 'services' });
    await ajouter(simatis, p.id, [regle('Règle à annuler')]);
    const [entree] = await listerJournalRegles(t.app.db, simatis, 1);
    await withInstance(t.app.db, simatis.id, (tx) => marquerReglesAnnulee(tx, entree!.id, null));
    const liste = await listerJournalRegles(t.app.db, simatis, 5);
    expect(liste.find((e) => e.id === entree!.id)?.statut).toBe('annule');
    expect(liste[0]).toMatchObject({ action: 'annulée', libelle: 'Règle à annuler' });
  });

  it('un motif de refus laisse l entrée active et garde le motif', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Journal E', activite: 'services' });
    await ajouter(simatis, p.id, [regle('Règle modifiée depuis')]);
    const [entree] = await listerJournalRegles(t.app.db, simatis, 1);
    await withInstance(t.app.db, simatis.id, (tx) =>
      marquerReglesAnnulee(tx, entree!.id, 'La fiche a changé depuis.'),
    );
    const apres = (await listerJournalRegles(t.app.db, simatis, 1))[0]!;
    expect(apres.id).toBe(entree!.id);
    expect(apres.statut).toBe('actif');
    expect(apres.motifRefus).toBe('La fiche a changé depuis.');
  });

  describe('enregistrerReglesRapport', () => {
    const doc = 'https://docs.google.com/document/d/doc-regles/edit';
    const projetEn = async (nom: string, demande: Demande | null) => {
      const p = await createProjet(t.app.db, simatis, { nom, activite: 'services' });
      await withInstance(t.app.db, simatis.id, (tx) =>
        tx
          .update(diagnosticProjets)
          .set({
            demande,
            rapportLiens: [{ lien: doc, le: '2026-11-01T08:00:00.000Z', version: 4, finale: true }],
          })
          .where(eq(diagnosticProjets.id, p.id)),
      );
      return p.id;
    };
    const enregistrer = (id: string, charge: Parameters<typeof enregistrerReglesRapport>[2]) =>
      withInstance(t.app.db, simatis.id, (tx) => enregistrerReglesRapport(tx, id, charge));

    it('écrit les changements avec l origine « version finale N »', async () => {
      const id = await projetEn('Atelier Outil A', 'regles_rapport');
      await enregistrer(id, { changements: [regle('Pas de proposition dans le rapport')] });
      const [e] = await listerJournalRegles(t.app.db, simatis, 1);
      expect(e).toMatchObject({ libelle: 'Pas de proposition dans le rapport', projetId: id });
      expect(e!.origine).toBe('version finale 4');
    });

    it('refuse hors demande de règles, sans rien écrire', async () => {
      const id = await projetEn('Atelier Outil B', null);
      await expect(enregistrer(id, { changements: [regle('Règle hors demande')] })).rejects.toThrow(
        SupportInvalide,
      );
      const liste = await listerJournalRegles(t.app.db, simatis, 50);
      expect(liste.map((e) => e.libelle)).not.toContain('Règle hors demande');
    });

    it('refuse un libellé qui contient le nom du projet, quelle que soit la casse', async () => {
      const id = await projetEn('Atelier Outil C', 'regles_rapport');
      await expect(
        enregistrer(id, {
          changements: [regle('Comme chez ATELIER outil c, ouvrir par le profil')],
        }),
      ).rejects.toThrow(SupportInvalide);
    });

    it('refuse un libellé trop long et plus de 20 changements', async () => {
      const id = await projetEn('Atelier Outil D', 'regles_rapport');
      await expect(enregistrer(id, { changements: [regle('x'.repeat(201))] })).rejects.toThrow(
        SupportInvalide,
      );
      const trop = Array.from({ length: 21 }, (_, n) => regle(`Règle fictive ${n}`));
      await expect(enregistrer(id, { changements: trop })).rejects.toThrow(SupportInvalide);
    });

    it('annulation effectuée : l entrée passe à annulée', async () => {
      const id = await projetEn('Atelier Outil E', 'regles_rapport');
      await enregistrer(id, { changements: [regle('Règle à retirer')] });
      const [entree] = await listerJournalRegles(t.app.db, simatis, 1);
      await withInstance(t.app.db, simatis.id, (tx) =>
        tx
          .update(diagnosticProjets)
          .set({ demande: 'regles_annuler' })
          .where(eq(diagnosticProjets.id, id)),
      );
      await enregistrer(id, { annulation: { journalId: entree!.id, effectuee: true } });
      const liste = await listerJournalRegles(t.app.db, simatis, 5);
      expect(liste.find((e) => e.id === entree!.id)?.statut).toBe('annule');
    });

    it('annulation impossible : l entrée reste active avec son motif', async () => {
      const id = await projetEn('Atelier Outil F', 'regles_rapport');
      await enregistrer(id, { changements: [regle('Règle déjà modifiée')] });
      const [entree] = await listerJournalRegles(t.app.db, simatis, 1);
      await withInstance(t.app.db, simatis.id, (tx) =>
        tx
          .update(diagnosticProjets)
          .set({ demande: 'regles_annuler' })
          .where(eq(diagnosticProjets.id, id)),
      );
      await enregistrer(id, {
        annulation: { journalId: entree!.id, effectuee: false, motif: 'La fiche a changé.' },
      });
      const apres = (await listerJournalRegles(t.app.db, simatis, 5)).find(
        (e) => e.id === entree!.id,
      )!;
      expect(apres).toMatchObject({ statut: 'actif', motifRefus: 'La fiche a changé.' });
    });

    it('une demande de règles du support écrit avec l origine « support final »', async () => {
      const id = await projetEn('Atelier Outil H', 'regles_support');
      await enregistrer(id, {
        changements: [{ ...regle('Ouvrir par le cadre de la séance'), fiche: 'support' }],
      });
      const [e] = await listerJournalRegles(t.app.db, simatis, 1);
      expect(e).toMatchObject({ fiche: 'support', libelle: 'Ouvrir par le cadre de la séance' });
      expect(e!.origine).toBe('support final');
    });

    it('une fiche du support peut aussi être déclarée pendant la demande du rapport', async () => {
      const id = await projetEn('Atelier Outil I', 'regles_rapport');
      await enregistrer(id, {
        changements: [{ ...regle('Règle du support vue en rapport'), fiche: 'support' }],
      });
      const [e] = await listerJournalRegles(t.app.db, simatis, 1);
      expect(e).toMatchObject({ fiche: 'support', origine: 'version finale 4' });
    });

    it('une demande de règles d analyse écrit avec l origine « analyse validée »', async () => {
      const id = await projetEn('Atelier Outil K', 'regles_analyse');
      await enregistrer(id, {
        changements: [{ ...regle('Garder le plan d action sans le reformuler'), fiche: 'analyse' }],
      });
      const [e] = await listerJournalRegles(t.app.db, simatis, 1);
      expect(e).toMatchObject({
        fiche: 'analyse',
        libelle: 'Garder le plan d action sans le reformuler',
      });
      expect(e!.origine).toBe('analyse validée');
    });

    it('une demande de règles du deck écrit avec l origine « deck final »', async () => {
      const id = await projetEn('Atelier Outil L', 'regles_restitution');
      await enregistrer(id, {
        changements: [
          { ...regle('Placer les options en dernière diapositive'), fiche: 'restitution' },
        ],
      });
      const [e] = await listerJournalRegles(t.app.db, simatis, 1);
      expect(e).toMatchObject({ fiche: 'restitution', origine: 'deck final' });
    });

    it('refuse sans aucune des demandes de règles', async () => {
      const id = await projetEn('Atelier Outil J', 'support_final');
      await expect(
        enregistrer(id, { changements: [{ ...regle('Règle hors demande'), fiche: 'support' }] }),
      ).rejects.toThrow(SupportInvalide);
    });

    it('une annulation exige la demande d annulation, pas celle de capitalisation', async () => {
      const id = await projetEn('Atelier Outil G', 'regles_rapport');
      await enregistrer(id, { changements: [regle('Règle protégée')] });
      const [entree] = await listerJournalRegles(t.app.db, simatis, 1);
      await expect(
        enregistrer(id, { annulation: { journalId: entree!.id, effectuee: true } }),
      ).rejects.toThrow(SupportInvalide);
    });
  });
});
