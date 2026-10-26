import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { creerMonde, fabrique, type Monde } from '../../test/transfert.js';
import { rechercherDans } from './recherche.js';

describe('rechercherDans', () => {
  let t: TestApp;
  let m: Monde;
  let f: ReturnType<typeof fabrique>;

  beforeAll(async () => {
    t = await setupTestApp();
    m = await creerMonde(t);
    f = fabrique(t);
    await f.contact(m.a, 'Dupont Fictif');
    await f.entreprise(m.a, 'Dupont Industrie Fictive');
    await f.affaire(m.a, 'Affaire Dupont');
    for (let i = 0; i < 7; i++) await f.contact(m.a, `Martin Fictif ${i}`);
  });
  afterAll(() => t.drop());

  it('trouve affaires, personnes et organisations de l’instance', async () => {
    const r = await rechercherDans(t.app.db, m.a, 'dupont');
    expect(r.personnes.map((p) => p.nom)).toEqual(['Dupont Fictif']);
    expect(r.organisations.map((o) => o.nom)).toEqual(['Dupont Industrie Fictive']);
    expect(r.affaires.map((a) => a.titre)).toEqual(['Affaire Dupont']);
  });

  it('ne renvoie rien sous deux caractères', async () => {
    expect(await rechercherDans(t.app.db, m.a, ' d ')).toEqual({
      affaires: [],
      personnes: [],
      organisations: [],
    });
  });

  it('limite à cinq résultats par type', async () => {
    const r = await rechercherDans(t.app.db, m.a, 'martin');
    expect(r.personnes).toHaveLength(5);
  });

  it('ne voit pas les données d’une autre instance', async () => {
    const r = await rechercherDans(t.app.db, m.b, 'dupont');
    expect(r).toEqual({ affaires: [], personnes: [], organisations: [] });
  });
});
