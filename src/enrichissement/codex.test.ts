import { expect, it } from 'vitest';
import { fileCodex } from './codex.js';

it('confie la recherche à un seul exécuteur et rend sa réponse au lot', async () => {
  const file = fileCodex();
  const demande = { consigne: 'Rechercher un dirigeant', entree: 'Société fictive', schema: {} };
  const reponse = file.client.demander(demande);
  const travail = file.prendre();
  expect(travail?.demande).toEqual(demande);
  expect(file.prendre()).toBeNull();
  const resultat = { candidats: [] };
  file.finir(travail!.id, resultat, true);
  await expect(reponse).resolves.toEqual({ json: resultat, jetons: 0 });
});
