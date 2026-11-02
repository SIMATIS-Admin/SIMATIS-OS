import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { insererFiche } from '../../test/fiche-base.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { ErreurIA, type ClientIA, type DemandeIA, type ReponseIA } from './client.js';
import {
  attendreLot,
  etatLot,
  lancerLot,
  LotRefuse,
  reprendreLotsInterrompus,
  type ReglagesLot,
} from './lot.js';
import { enrichissementLignes, enrichissementSuggestions, enrichissementTaches } from './schema.js';

const REGLAGES: ReglagesLot = { lotMax: 10, budgetJetons: 100000, parallelisme: 3 };
const contact = (nom: string) => ({
  prenom: 'Claire',
  nom,
  fonction: 'Responsable achats',
  email: `claire@${nom.toLowerCase()}.test`,
  telephone: null,
  sourceUrl: `https://${nom.toLowerCase()}.test/equipe`,
  confiance: 'haute',
  modeEmail: 'trouve',
});
const entrepriseDe = (d: DemandeIA) => /Entreprise : (.*)/.exec(d.entree)?.[1] ?? '';

describe('traitement d’un lot d’enrichissement', () => {
  let t: TestApp;
  let n = 0;
  let instanceId: string;
  let appels: string[];
  let reponse: (entreprise: string) => Promise<ReponseIA> | ReponseIA;
  let enVol = 0;
  let maxEnVol = 0;
  const client: ClientIA = {
    async demander(d) {
      appels.push(entrepriseDe(d));
      enVol++;
      maxEnVol = Math.max(maxEnVol, enVol);
      try {
        await new Promise((r) => setTimeout(r, 5));
        return await reponse(entrepriseDe(d));
      } finally {
        enVol--;
      }
    },
  };

  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    n++;
    instanceId = (
      await createInstance(t.owner.db, { slug: `lot-${n}`, nom: `Lot ${n}`, type: 'mandat' })
    ).id;
    appels = [];
    enVol = 0;
    maxEnVol = 0;
    reponse = (e) => ({ json: { contacts: [contact(e.replace(/\W/g, ''))] }, jetons: 100 });
  });

  const suggestions = () =>
    t.owner.db
      .select()
      .from(enrichissementSuggestions)
      .where(eq(enrichissementSuggestions.instanceId, instanceId));
  const suggestionsLignes = () =>
    t.owner.db
      .select()
      .from(enrichissementLignes)
      .where(eq(enrichissementLignes.instanceId, instanceId));
  const fiche = (entreprise: string, extra: Record<string, unknown> = {}) =>
    insererFiche(t.owner.db, {
      instanceId,
      zone: 'a_enrichir',
      entreprise,
      nom: '',
      provenance: 'test',
      ...extra,
    });
  const params = (ficheIds: string[], extra = {}) => ({
    type: 'contacts' as const,
    profil: ['Responsable achats'],
    maxParEntreprise: 2,
    ficheIds,
    ...extra,
  });
  const lancer = async (p: ReturnType<typeof params>, reglages = REGLAGES) => {
    const tache = await lancerLot(t.app.db, client, reglages, instanceId, p);
    await attendreLot(tache.id);
    return etatLot(t.app.db, instanceId, tache.id);
  };

  it('trois fiches, réponses valides : tâche terminée, suggestions à valider', async () => {
    const ids = [
      await fiche('Atelier Fictif'),
      await fiche('Bureau Fictif'),
      await fiche('Cabinet Fictif'),
    ];
    const { tache, lignes } = await lancer(params(ids));
    expect(tache).toMatchObject({ etat: 'terminee', jetons: 300 });
    expect(lignes.map((l) => l.etat)).toEqual(['terminee', 'terminee', 'terminee']);
    const sugg = await suggestions();
    expect(sugg).toHaveLength(3);
    expect(sugg[0]).toMatchObject({ tacheId: tache.id, etat: 'a_valider', modeEmail: 'trouve' });
  });

  it('une réponse hors schéma met cette fiche en échec, les autres terminent', async () => {
    const ids = [await fiche('Atelier Fictif'), await fiche('Bureau Fictif')];
    reponse = (e) =>
      e === 'Bureau Fictif'
        ? { json: { rien: 1 }, jetons: 10 }
        : { json: { contacts: [contact('Atelier')] }, jetons: 10 };
    const { tache, lignes } = await lancer(params(ids));
    expect(tache.etat).toBe('terminee');
    expect(lignes.find((l) => l.etat === 'echec')?.raison).toMatch(/schéma/);
    expect(await suggestions()).toHaveLength(1);
  });

  it('une erreur fatale interrompt le lot : fiches restantes ignorées, rien d’écrit', async () => {
    const ids = [
      await fiche('Atelier Fictif'),
      await fiche('Bureau Fictif'),
      await fiche('Cabinet Fictif'),
    ];
    reponse = () => {
      throw new ErreurIA('Clé OpenAI refusée', true);
    };
    const { tache, lignes } = await lancer(params(ids), { ...REGLAGES, parallelisme: 1 });
    expect(tache).toMatchObject({ etat: 'interrompue', erreur: 'Clé OpenAI refusée' });
    expect(lignes.map((l) => l.etat)).toEqual(['echec', 'ignoree', 'ignoree']);
    expect(lignes[1]?.raison).toMatch(/Clé OpenAI refusée/);
    expect(await suggestions()).toHaveLength(0);
  });

  it('le budget de jetons arrête les fiches non commencées', async () => {
    const ids = [
      await fiche('Atelier Fictif'),
      await fiche('Bureau Fictif'),
      await fiche('Cabinet Fictif'),
    ];
    reponse = () => ({ json: { contacts: [] }, jetons: 300 });
    const { lignes } = await lancer(params(ids), {
      ...REGLAGES,
      budgetJetons: 500,
      parallelisme: 1,
    });
    expect(lignes.map((l) => l.etat)).toEqual(['terminee', 'terminee', 'ignoree']);
    expect(lignes[2]?.raison).toBe('Budget du lot atteint');
  });

  it('refuse un lot vide, trop grand, ou sans fonction recherchée', async () => {
    const ids = await Promise.all(Array.from({ length: 11 }, (_, i) => fiche(`Société ${i}`)));
    await expect(lancerLot(t.app.db, client, REGLAGES, instanceId, params(ids))).rejects.toThrow(
      LotRefuse,
    );
    await expect(lancerLot(t.app.db, client, REGLAGES, instanceId, params([]))).rejects.toThrow(
      LotRefuse,
    );
    await expect(
      lancerLot(t.app.db, client, REGLAGES, instanceId, params(ids.slice(0, 1), { profil: [] })),
    ).rejects.toThrow(LotRefuse);
    expect(appels).toEqual([]);
  });

  it('écarte sans appeler l’IA : opposition, exclusion, contact déjà complet, fiche inconnue', async () => {
    const opposee = await fiche('Atelier Fictif', { opposition: true });
    const exclue = await fiche('Bureau Fictif', { exclusion: 'client' });
    const complete = await fiche('Cabinet Fictif', {
      zone: 'prospectable',
      prenom: 'Paul',
      nom: 'PETIT',
      email: 'paul@cabinet.test',
    });
    const bonne = await fiche('Garage Fictif');
    const inconnue = '00000000-0000-4000-8000-000000000000';
    const { lignes } = await lancer(params([opposee, exclue, complete, bonne, inconnue]));
    expect(lignes).toHaveLength(4);
    expect(lignes.filter((l) => l.etat === 'ignoree').map((l) => l.raison)).toEqual([
      'Fiche en opposition',
      'Fiche exclue (client)',
      'Contact déjà complet',
    ]);
    expect(appels).toEqual(['Garage Fictif']);
    await expect(
      lancerLot(t.app.db, client, REGLAGES, instanceId, params([inconnue])),
    ).rejects.toThrow(LotRefuse);
  });

  it('pour compléter, ignore une fiche sans contact ou déjà complète', async () => {
    const sansContact = await fiche('Atelier Fictif');
    const complete = await fiche('Bureau Fictif', {
      zone: 'prospectable',
      prenom: 'Paul',
      nom: 'PETIT',
      email: 'paul@bureau.test',
      telephone: '+33450123456',
    });
    const aCompleter = await fiche('Cabinet Fictif', {
      zone: 'prospectable',
      prenom: 'Zoé',
      nom: 'ROUX',
      email: 'zoe@cabinet.test',
    });
    const { lignes } = await lancer(
      params([sansContact, complete, aCompleter], { type: 'completer', profil: [] }),
    );
    expect(lignes.map((l) => l.etat)).toEqual(['ignoree', 'ignoree', 'terminee']);
    expect(appels).toEqual(['Cabinet Fictif']);
  });

  it('ne dépasse jamais le parallélisme', async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, (_, i) => fiche(`Société ${i}`)));
    await lancer(params(ids));
    expect(appels).toHaveLength(8);
    expect(maxEnVol).toBeLessThanOrEqual(3);
    expect(maxEnVol).toBeGreaterThan(1);
  });

  it('refuse un second lot pendant qu’un lot tourne', async () => {
    const ids = [await fiche('Atelier Fictif')];
    const autre = [await fiche('Bureau Fictif')];
    const tache = await lancerLot(t.app.db, client, REGLAGES, instanceId, params(ids));
    await expect(lancerLot(t.app.db, client, REGLAGES, instanceId, params(autre))).rejects.toThrow(
      LotRefuse,
    );
    await attendreLot(tache.id);
    await expect(lancer(params(autre))).resolves.toBeDefined();
  });

  it('reprend un lot laissé en cours après un redémarrage', async () => {
    const id = await fiche('Atelier Fictif');
    const [tache] = await withInstance(t.app.db, instanceId, (tx) =>
      tx
        .insert(enrichissementTaches)
        .values({
          instanceId,
          type: 'contacts',
          profil: ['DRH'],
          maxParEntreprise: 1,
          etat: 'en_cours',
        })
        .returning(),
    );
    await withInstance(t.app.db, instanceId, (tx) =>
      tx
        .insert(enrichissementLignes)
        .values({ instanceId, tacheId: tache!.id, ficheId: id, etat: 'en_cours' }),
    );
    await reprendreLotsInterrompus(t.app.db, client, REGLAGES);
    await attendreLot(tache!.id);
    const { tache: apres, lignes } = await etatLot(t.app.db, instanceId, tache!.id);
    expect(apres.etat).toBe('terminee');
    expect(lignes[0]?.etat).toBe('terminee');
    expect(appels).toEqual(['Atelier Fictif']);
  });

  it('ne garde jamais la clé dans une raison ou une erreur', async () => {
    const id = await fiche('Atelier Fictif');
    reponse = () => {
      throw new ErreurIA('OpenAI indisponible (HTTP 500)', false);
    };
    const { tache, lignes } = await lancer(params([id]));
    expect(JSON.stringify([tache, lignes])).not.toMatch(/sk-|Bearer/);
    expect((await suggestionsLignes()).filter((l) => l.etat === 'echec')).toHaveLength(1);
  });
});
