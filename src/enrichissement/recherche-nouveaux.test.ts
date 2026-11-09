import { expect, it, vi } from 'vitest';
import { integrerFiches } from '../base-vivante/integration.js';
import { normaliserFiche } from '../base-vivante/nettoyage.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { setupTestApp } from '../../test/database.js';
import { chercherNouveauxProspects } from './recherche-nouveaux.js';

it('ne compte pas un contact déjà présent dans la Base vivante et poursuit jusqu’à l’objectif', async () => {
  const t = await setupTestApp();
  try {
    const instance = await createInstance(t.owner.db, {
      slug: 'nouveaux-prospects',
      nom: 'Nouveaux prospects',
      type: 'propre',
    });
    await withInstance(t.app.db, instance.id, (tx) =>
      integrerFiches(tx, instance.id, [
        {
          fiche: normaliserFiche({
            entreprise: 'Entreprise existante',
            prenom: 'Alice',
            nom: 'EXEMPLE',
            email: 'alice@existante.example',
            fonction: 'Direction',
          }).fiche,
          provenance: 'Test',
          mandat: null,
          importId: null,
          collecteLe: null,
        },
      ]),
    );

    let passage = 0;
    const demander = vi.fn(() => {
      passage++;
      const contacts =
        passage === 1
          ? [
              candidat('Doublon', 'alice@existante.example'),
              candidat('Nouveau 1', 'nouveau1@nouvelle.example'),
            ]
          : [candidat('Nouveau 2', 'nouveau2@nouvelle.example')];
      return Promise.resolve({ json: { contacts }, jetons: 0 });
    });

    const resultat = await chercherNouveauxProspects(
      t.app.db,
      { demander },
      instance.id,
      'Critères fictifs',
      2,
    );
    expect(resultat.contacts.map((c) => c.nom)).toEqual(['Nouveau 1', 'Nouveau 2']);
    expect(demander).toHaveBeenCalledTimes(2);
  } finally {
    await t.drop();
  }
});

const candidat = (nom: string, email: string) => ({
  entreprise: nom === 'Doublon' ? 'Autre libellé' : 'Entreprise nouvelle',
  prenom: 'Alice',
  nom,
  fonction: 'Direction',
  email,
  linkedin: null,
  source: 'https://exemple.test/equipe',
  qualification: 'Données fictives',
});
