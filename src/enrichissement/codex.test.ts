import { expect, it, vi } from 'vitest';
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

it('laisse une recherche dépasser trois minutes puis libère la file à expiration', async () => {
  vi.useFakeTimers();
  try {
    const file = fileCodex();
    const reponse = file.client.demander({ consigne: 'Test fictif', entree: '', schema: {} });
    const rejet = expect(reponse).rejects.toThrow('Le programme Codex local n’a pas répondu.');
    await vi.advanceTimersByTimeAsync(180_000);
    expect(file.prendre()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(420_000);
    await rejet;
    expect(file.prendre()).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
