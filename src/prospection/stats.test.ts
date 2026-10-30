import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { taches } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { prospectionOccurrences, prospectionReglages, type EtatOccurrence } from './schema.js';
import { statsProspection } from './stats.js';

describe('Statistiques de prospection', () => {
  let t: TestApp;
  let a: string;
  let b: string;
  let vide: string;

  beforeAll(async () => {
    t = await setupTestApp();
    a = (await createInstance(t.owner.db, { slug: 'stats-a', nom: 'A', type: 'mandat' })).id;
    b = (await createInstance(t.owner.db, { slug: 'stats-b', nom: 'B', type: 'mandat' })).id;
    vide = (await createInstance(t.owner.db, { slug: 'stats-vide', nom: 'Vide', type: 'mandat' }))
      .id;
  });

  afterAll(async () => {
    await t.drop();
  });

  const occurrence = (
    instanceId: string,
    envoyeAt: string,
    o: { etat?: EtatOccurrence; theme?: string; touche?: number } = {},
  ) => ({
    instanceId,
    mode: 'froid' as const,
    contactNom: 'Contact fictif',
    theme: o.theme ?? 'Test de VMA',
    touche: o.touche ?? 1,
    etat: o.etat ?? ('envoye' as const),
    envoyeAt: new Date(envoyeAt),
  });
  const stats = (instanceId: string, maintenant: string) =>
    withInstance(t.app.db, instanceId, (tx) => statsProspection(tx, new Date(maintenant)));

  it("compte les mails envoyés aujourd'hui, jamais les brouillons", async () => {
    await t.owner.db
      .insert(prospectionOccurrences)
      .values([
        occurrence(a, '2026-11-02T09:00:00Z'),
        occurrence(a, '2026-11-02T10:00:00Z'),
        occurrence(a, '2026-11-02T11:00:00Z'),
        occurrence(a, '2026-11-02T12:00:00Z', { etat: 'brouillon' }),
        occurrence(a, '2026-11-02T13:00:00Z', { etat: 'brouillon' }),
      ]);
    const s = await stats(a, '2026-11-02T14:00:00Z');
    expect(s.jour).toBe(3);
    expect(s.semaine).toBe(3);
  });

  it('range un mail de 23 h 59 à Paris dans son jour', async () => {
    await t.owner.db.insert(prospectionOccurrences).values(occurrence(b, '2026-11-03T22:59:00Z'));
    expect((await stats(b, '2026-11-03T22:59:59Z')).jour).toBe(1);
    const lendemain = await stats(b, '2026-11-03T23:01:00Z');
    expect(lendemain.jour).toBe(0);
    expect(lendemain.semaine).toBe(1);
  });

  it('calcule la semaine, les réponses, les rendez-vous, par thème et par touche', async () => {
    const i = (await createInstance(t.owner.db, { slug: 'stats-sem', nom: 'S', type: 'mandat' }))
      .id;
    await t.owner.db
      .insert(prospectionOccurrences)
      .values([
        occurrence(i, '2026-11-09T09:00:00Z', { theme: 'Test de VMA', touche: 1 }),
        occurrence(i, '2026-11-08T09:00:00Z', { theme: 'Test de VMA', touche: 2, etat: 'reponse' }),
        occurrence(i, '2026-11-07T09:00:00Z', { theme: 'Test de VMA', touche: 1 }),
        occurrence(i, '2026-11-06T09:00:00Z', { theme: 'Diagnostic', touche: 3, etat: 'rdv' }),
        occurrence(i, '2026-11-05T09:00:00Z', { theme: 'Diagnostic', touche: 1 }),
        occurrence(i, '2026-11-01T09:00:00Z', { theme: 'Diagnostic', touche: 1 }),
      ]);
    const s = await stats(i, '2026-11-09T12:00:00Z');
    expect(s.semaine).toBe(5);
    expect(s.reponses).toBe(2);
    expect(s.rdv).toBe(1);
    expect(s.parTheme).toEqual({ 'Test de VMA': 3, Diagnostic: 2 });
    expect(s.parTouche).toEqual({ '1': 3, '2': 1, '3': 1 });
  });

  it("renvoie des zéros pour une instance vide et l'objectif par défaut", async () => {
    expect(await stats(vide, '2026-11-02T14:00:00Z')).toEqual({
      jour: 0,
      objectif: 30,
      semaine: 0,
      reponses: 0,
      rdv: 0,
      parTheme: {},
      parTouche: {},
      relancesFaites: 0,
      relancesRestantes: 0,
      aConfirmer: 0,
    });
  });

  it("lit l'objectif réglé pour l'instance", async () => {
    await t.owner.db.insert(prospectionReglages).values({ instanceId: a, objectifJour: 45 });
    expect((await stats(a, '2026-11-02T14:00:00Z')).objectif).toBe(45);
    expect((await stats(b, '2026-11-02T14:00:00Z')).objectif).toBe(30);
  });

  it("ne voit pas les occurrences d'une autre instance", async () => {
    expect((await stats(vide, '2026-11-02T14:00:00Z')).jour).toBe(0);
    expect((await stats(a, '2026-11-02T14:00:00Z')).jour).toBe(3);
  });

  it('compte les relances par mail faites et restantes', async () => {
    const i = (await createInstance(t.owner.db, { slug: 'stats-rel', nom: 'R', type: 'mandat' }))
      .id;
    const tache = (titre: string, canal: 'email' | 'appel', echeance: string, faitAt?: string) => ({
      instanceId: i,
      titre,
      canal,
      echeance: new Date(echeance),
      faitAt: faitAt ? new Date(faitAt) : null,
    });
    await t.owner.db
      .insert(taches)
      .values([
        tache('Relance faite', 'email', '2026-11-02T08:00:00Z', '2026-11-02T09:00:00Z'),
        tache('Relance en retard', 'email', '2026-10-30T08:00:00Z'),
        tache('Relance du jour', 'email', '2026-11-02T08:00:00Z'),
        tache('Relance à venir', 'email', '2026-11-20T08:00:00Z'),
        tache('Appel du jour', 'appel', '2026-11-02T08:00:00Z'),
      ]);
    const s = await stats(i, '2026-11-02T14:00:00Z');
    expect(s.relancesFaites).toBe(1);
    expect(s.relancesRestantes).toBe(2);
  });
});
