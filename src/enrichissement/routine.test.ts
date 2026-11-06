import { expect, it, vi } from 'vitest';
import { setupTestApp } from '../../test/database.js';
import { listerFiches } from '../base-vivante/service.js';
import { createInstance } from '../instances/service.js';
import { dernieresSessions } from './sessions.js';
import { enregistrerRoutineRecherche, lireRoutineRecherche, tournerRecherche } from './routine.js';

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
    await tournerRecherche(t.app.db, { demander }, new Date('2026-11-03T07:59:00Z'));
    expect(demander).not.toHaveBeenCalled();
    const heure = new Date('2026-11-03T08:00:00Z');
    await Promise.all([
      tournerRecherche(t.app.db, { demander }, heure),
      tournerRecherche(t.app.db, { demander }, heure),
    ]);
    expect(demander).toHaveBeenCalledTimes(1);
    expect((await listerFiches(t.app.db, instance.id, { canal: 'linkedin' })).total).toBe(1);
    expect((await lireRoutineRecherche(t.app.db, instance.id)).bilan).toContain(
      '1 fiche(s) ajoutée(s)',
    );
    expect(await lireRoutineRecherche(t.app.db, instance.id)).toMatchObject({
      dernierJour: '2026-11-03',
    });
    expect(await dernieresSessions(t.app.db, instance.id)).toMatchObject([
      {
        nature: 'recherche',
        mode: 'automatique',
        etat: 'incomplete',
        traites: 1,
        ajoutees: 1,
      },
    ]);
  } finally {
    await t.drop();
  }
});
