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
