import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  ajouterChangementsRegles,
  listerJournalRegles,
  marquerReglesAnnulee,
  type ChangementRegle,
} from './regles.js';
import { diagnosticProjets } from './schema.js';
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
});
