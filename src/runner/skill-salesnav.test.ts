import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ROUTINES } from '../routines/params.js';
import { RESULTATS_ENVOI } from '../salesnav/envois.js';

// La skill vit hors de l'OS une fois installée : ce test évite qu'elle décroche de la routine et des
// outils que l'OS lui offre.
describe('skill Envoi SalesNav', () => {
  const lire = () => readFile('runner/skills/envoyer-demande-salesnav/SKILL.md', 'utf8');

  it('porte le nom de la skill de la routine', async () => {
    const routine = ROUTINES.find((r) => r.cle === 'salesnav');
    const skill = await lire();
    expect(skill).toMatch(new RegExp(`^---\\nname: ${routine?.skill}\\n`));
  });

  it('nomme les deux outils de l’OS et tous les résultats possibles', async () => {
    const skill = await lire();
    for (const mot of ['salesnav_envoi_a_faire', 'salesnav_envoi_rapport', ...RESULTATS_ENVOI])
      expect(skill).toContain(mot);
  });

  it('interdit d’envoyer en essai à blanc et d’enchaîner les profils', async () => {
    const skill = await lire();
    expect(skill).toMatch(/n'appuie \*\*pas\*\* sur « Envoyer »/);
    expect(skill).toMatch(/jamais\*\* sur un deuxième profil/);
  });
});
