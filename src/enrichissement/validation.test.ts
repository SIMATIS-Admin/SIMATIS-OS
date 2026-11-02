import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { insererFiche } from '../../test/fiche-base.js';
import { createInstance } from '../instances/service.js';
import { enrichissementSuggestions, enrichissementTaches } from './schema.js';
import { suggestionsDeLaTache, valider } from './validation.js';

describe('validation des suggestions', () => {
  let t: TestApp;
  let n = 0;
  let instanceId: string;
  let tacheId: string;

  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    n++;
    instanceId = (
      await createInstance(t.owner.db, { slug: `val-${n}`, nom: `Val ${n}`, type: 'mandat' })
    ).id;
    [{ id: tacheId }] = (await t.owner.db
      .insert(enrichissementTaches)
      .values({
        instanceId,
        type: 'contacts',
        profil: ['DRH'],
        maxParEntreprise: 2,
        etat: 'terminee',
      })
      .returning({ id: enrichissementTaches.id })) as [{ id: string }];
  });

  const fiche = (entreprise: string, extra: Record<string, unknown> = {}) =>
    insererFiche(t.owner.db, {
      instanceId,
      zone: 'a_enrichir',
      entreprise,
      nom: '',
      provenance: 'test',
      ...extra,
    });
  const suggestion = async (ficheId: string, extra: Record<string, unknown> = {}) =>
    (
      await t.owner.db
        .insert(enrichissementSuggestions)
        .values({
          instanceId,
          tacheId,
          ficheId,
          prenom: 'Claire',
          nom: 'Martin',
          email: 'claire@atelier-fictif.test',
          sourceUrl: 'https://atelier-fictif.test/equipe',
          confiance: 'haute',
          modeEmail: 'trouve',
          ...extra,
        })
        .returning({ id: enrichissementSuggestions.id })
    )[0]!.id;
  const etatDe = async (id: string) =>
    (
      await t.owner.db
        .select({ etat: enrichissementSuggestions.etat })
        .from(enrichissementSuggestions)
        .where(eq(enrichissementSuggestions.id, id))
    )[0]?.etat;
  const zoneDe = async (id: string) =>
    (
      await t.owner.pool.query<{ zone: string; nom: string }>(
        'select zone, nom from base_vivante where id = $1',
        [id],
      )
    ).rows[0];

  it('accepter remplit la fiche à enrichir et marque la suggestion acceptée', async () => {
    const f = await fiche('Atelier Fictif');
    const s = await suggestion(f);
    expect(await valider(t.app.db, instanceId, tacheId, [s], [])).toMatchObject({
      appliquees: 1,
      creees: 0,
    });
    expect(await zoneDe(f)).toEqual({ zone: 'prospectable', nom: 'MARTIN' });
    expect(await etatDe(s)).toBe('acceptee');
  });

  it('refuser laisse la fiche intacte', async () => {
    const f = await fiche('Atelier Fictif');
    const s = await suggestion(f);
    await valider(t.app.db, instanceId, tacheId, [], [s]);
    expect(await zoneDe(f)).toEqual({ zone: 'a_enrichir', nom: '' });
    expect(await etatDe(s)).toBe('refusee');
  });

  it('une suggestion non cochée reste à valider', async () => {
    const f = await fiche('Atelier Fictif');
    const s = await suggestion(f);
    await valider(t.app.db, instanceId, tacheId, [], []);
    expect(await etatDe(s)).toBe('a_valider');
  });

  it('deux contacts pour la même entreprise : le second a sa propre fiche', async () => {
    const f = await fiche('Atelier Fictif');
    const a = await suggestion(f);
    const b = await suggestion(f, {
      prenom: 'Paul',
      nom: 'Petit',
      email: 'paul@atelier-fictif.test',
    });
    expect(await valider(t.app.db, instanceId, tacheId, [a, b], [])).toMatchObject({
      appliquees: 2,
      creees: 1,
    });
  });

  it('valider deux fois la même suggestion est sans effet', async () => {
    const f = await fiche('Atelier Fictif');
    const s = await suggestion(f);
    await valider(t.app.db, instanceId, tacheId, [s], []);
    expect(await valider(t.app.db, instanceId, tacheId, [s], [])).toMatchObject({
      appliquees: 0,
      creees: 0,
    });
  });

  it('ignore l’identifiant d’une autre instance ou d’une autre tâche', async () => {
    const f = await fiche('Atelier Fictif');
    const s = await suggestion(f);
    const autre = (
      await createInstance(t.owner.db, { slug: `val-x${n}`, nom: 'X', type: 'mandat' })
    ).id;
    expect(await valider(t.app.db, autre, tacheId, [s], [])).toMatchObject({ appliquees: 0 });
    expect(
      await valider(t.app.db, instanceId, '00000000-0000-4000-8000-000000000000', [s], []),
    ).toMatchObject({ appliquees: 0 });
    expect(await etatDe(s)).toBe('a_valider');
  });

  it('une fiche supprimée entre-temps n’a plus de suggestion et ne fait pas d’erreur', async () => {
    const f = await fiche('Atelier Fictif');
    const s = await suggestion(f);
    await t.owner.pool.query('delete from base_vivante where id = $1', [f]);
    expect(await valider(t.app.db, instanceId, tacheId, [s], [])).toMatchObject({ appliquees: 0 });
  });

  it('expose les suggestions avec l’entreprise, le contact existant et le mode du mail', async () => {
    const vide = await fiche('Atelier Fictif');
    const connue = await fiche('Bureau Fictif', {
      zone: 'prospectable',
      prenom: 'Zoé',
      nom: 'ROUX',
      email: 'zoe@bureau-fictif.test',
    });
    const a = await suggestion(vide, { modeEmail: 'deduit', confiance: 'basse' });
    await suggestion(connue, { prenom: 'Paul', nom: 'Petit' });
    await valider(t.app.db, instanceId, tacheId, [], []);
    const liste = await suggestionsDeLaTache(t.app.db, instanceId, tacheId);
    expect(liste.find((x) => x.id === a)).toMatchObject({
      entreprise: 'Atelier Fictif',
      contactExistant: null,
      modeEmail: 'deduit',
    });
    expect(liste.find((x) => x.entreprise === 'Bureau Fictif')?.contactExistant).toBe('Zoé ROUX');
  });

  it('un mail déduit accepté est écrit tel quel', async () => {
    const f = await fiche('Atelier Fictif');
    const s = await suggestion(f, { modeEmail: 'deduit', confiance: 'basse' });
    await valider(t.app.db, instanceId, tacheId, [s], []);
    const { rows } = await t.owner.pool.query<{ email: string }>(
      'select email from base_vivante where id = $1',
      [f],
    );
    expect(rows[0]?.email).toBe('claire@atelier-fictif.test');
  });
});
