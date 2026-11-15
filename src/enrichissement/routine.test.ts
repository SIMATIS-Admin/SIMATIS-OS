import { eq, sql } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { preferences } from '../preferences/schema.js';
import { setupTestApp } from '../../test/database.js';
import { listerFiches } from '../base-vivante/service.js';
import { withInstance } from '../db/context.js';
import { recentEvents } from '../journal/service.js';
import { createInstance } from '../instances/service.js';
import { dernieresSessions, ouvrirSessionRecherche } from './sessions.js';
import {
  enregistrerRoutineRecherche,
  lireRoutineRecherche,
  reprendreRecherchesInterrompues,
  tournerRecherche,
} from './routine.js';

it('ajoute les contacts au plus une fois par jour après l’heure de Paris', async () => {
  const t = await setupTestApp();
  try {
    const instance = await createInstance(t.owner.db, {
      slug: 'routine-test',
      nom: 'Test',
      type: 'propre',
    });
    await enregistrerRoutineRecherche(t.app.db, instance.id, {
      active: true,
      consignes: 'PME fictives',
      nombre: 12,
      heure: '09:00',
    });
    let passage = 0;
    const demander = vi.fn(() => {
      passage++;
      return Promise.resolve({
        json: {
          contacts: Array.from({ length: 10 }, (_, i) => ({
            entreprise: `Atelier Fictif ${passage}-${i}`,
            prenom: 'Alice',
            nom: `Martin ${passage}-${i}`,
            fonction: 'Dirigeante',
            email: null,
            linkedin: `https://www.linkedin.com/in/alice-fictive-${passage}-${i}`,
            source: 'https://exemple.test/equipe',
            qualification: 'Industrie',
          })),
        },
        jetons: 0,
      });
    });
    await tournerRecherche(t.app.db, { demander }, new Date('2026-11-03T07:59:00Z'));
    expect(demander).not.toHaveBeenCalled();
    const heure = new Date('2026-11-03T08:00:00Z');
    await Promise.all([
      tournerRecherche(t.app.db, { demander }, heure),
      tournerRecherche(t.app.db, { demander }, heure),
    ]);
    expect(demander).toHaveBeenCalledTimes(2);
    expect((await listerFiches(t.app.db, instance.id, { canal: 'linkedin' })).total).toBe(12);
    expect((await lireRoutineRecherche(t.app.db, instance.id)).bilan).toContain(
      '12 fiche(s) ajoutée(s)',
    );
    expect(await lireRoutineRecherche(t.app.db, instance.id)).toMatchObject({
      dernierJour: '2026-11-03',
    });
    expect(await dernieresSessions(t.app.db, instance.id)).toMatchObject([
      {
        nature: 'recherche',
        mode: 'automatique',
        etat: 'terminee',
        traites: 12,
        ajoutees: 12,
      },
    ]);
  } finally {
    await t.drop();
  }
});

it('clôt la journée quand le moteur ne trouve plus de nouveau contact, et le dit dans la console', async () => {
  const t = await setupTestApp();
  try {
    const instance = await createInstance(t.owner.db, {
      slug: 'routine-epuisee',
      nom: 'Test',
      type: 'propre',
    });
    await enregistrerRoutineRecherche(t.app.db, instance.id, {
      active: true,
      consignes: 'PME fictives',
      nombre: 10,
      heure: '09:00',
    });
    // Le moteur repropose toujours la même personne : un seul contact nouveau, puis plus rien.
    const demander = vi.fn(() =>
      Promise.resolve({
        json: {
          contacts: [
            {
              entreprise: 'Atelier Fictif',
              prenom: 'Alice',
              nom: 'Martin',
              fonction: 'Dirigeante',
              email: null,
              linkedin: 'https://www.linkedin.com/in/alice-fictive-unique',
              source: 'https://exemple.test/equipe',
              qualification: 'Industrie',
            },
          ],
        },
        jetons: 0,
      }),
    );
    await tournerRecherche(t.app.db, { demander }, new Date('2026-11-03T08:00:00Z'));
    expect(demander).toHaveBeenCalledTimes(4);
    expect((await listerFiches(t.app.db, instance.id, { canal: 'linkedin' })).total).toBe(1);
    const routine = await lireRoutineRecherche(t.app.db, instance.id);
    expect(routine.bilan).toContain('1 fiche(s) ajoutée(s)');
    expect(routine.bilan).toContain('élargissez les consignes');
    expect(routine).toMatchObject({ dernierJour: '2026-11-03' });
    expect(await dernieresSessions(t.app.db, instance.id)).toMatchObject([
      { mode: 'automatique', etat: 'terminee', ajoutees: 1 },
    ]);
    const journal = await withInstance(t.app.db, instance.id, (tx) => recentEvents(tx));
    expect(journal.map((e) => e.action)).toContainEqual(
      expect.stringContaining('élargissez les consignes'),
    );

    // Le même jour, la routine ne repart pas.
    await tournerRecherche(t.app.db, { demander }, new Date('2026-11-03T12:00:00Z'));
    expect(demander).toHaveBeenCalledTimes(4);
  } finally {
    await t.drop();
  }
});

it('reprend après un redémarrage la recherche automatique restée ouverte', async () => {
  const t = await setupTestApp();
  try {
    const instance = await createInstance(t.owner.db, {
      slug: 'reprise-test',
      nom: 'Test',
      type: 'propre',
    });
    await enregistrerRoutineRecherche(t.app.db, instance.id, {
      active: true,
      consignes: 'PME fictives',
      nombre: 1,
      heure: '09:00',
    });
    const demander = vi.fn(() =>
      Promise.resolve({
        json: {
          contacts: [
            {
              entreprise: 'Atelier Fictif',
              prenom: 'Alice',
              nom: 'Martin',
              fonction: 'Dirigeante',
              email: null,
              linkedin: 'https://www.linkedin.com/in/alice-fictive',
              source: 'https://exemple.test/equipe',
              qualification: 'Industrie',
            },
          ],
        },
        jetons: 0,
      }),
    );
    // Simule une recherche démarrée à 10 h, tuée par un redémarrage avant sa clôture.
    await t.app.db
      .update(preferences)
      .set({
        options: sql`jsonb_set(${preferences.options}, '{rechercheBase,dernierJour}', '"2026-11-03"')`,
      })
      .where(eq(preferences.utilisateur, 'routine-recherche-base:' + instance.id));
    await ouvrirSessionRecherche(t.app.db, instance.id, { mode: 'automatique', nombreVise: 1 });
    const heure = new Date('2026-11-03T09:30:00Z');
    await tournerRecherche(t.app.db, { demander }, heure);
    expect(demander).not.toHaveBeenCalled();

    await reprendreRecherchesInterrompues(t.app.db, heure);
    expect(await dernieresSessions(t.app.db, instance.id)).toMatchObject([
      { etat: 'erreur', detail: expect.stringContaining('redémarrage') as string },
    ]);
    await tournerRecherche(t.app.db, { demander }, heure);
    expect(demander).toHaveBeenCalledTimes(1);
    expect(await dernieresSessions(t.app.db, instance.id)).toMatchObject([
      { etat: 'terminee', ajoutees: 1 },
      { etat: 'erreur' },
    ]);

    // Une recherche déjà terminée du jour n'est pas relancée.
    await reprendreRecherchesInterrompues(t.app.db, heure);
    await tournerRecherche(t.app.db, { demander }, heure);
    expect(demander).toHaveBeenCalledTimes(1);
  } finally {
    await t.drop();
  }
});
