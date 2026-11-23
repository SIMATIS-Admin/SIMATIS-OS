import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { indicateurs } from './actions.js';
import {
  alerteAcceptation,
  dansLesHeuresOuvrees,
  demanderEnvoi,
  derniersEnvois,
  EnvoiRefuse,
  rapporterEnvoi,
  recupererEnvoi,
} from './envois.js';
import { ajouterProspect, listerProspects } from './prospects.js';
import { lireReglages, sauverReglages } from './reglages.js';
import { salesnavProspects } from './schema.js';

// Personnes et entreprises fictives. Mercredi 25/11/2026, 10 h à Paris.
const MERCREDI = new Date('2026-11-25T09:00:00Z');
const SAMEDI = new Date('2026-11-28T09:00:00Z');
const NOTE = 'Bonjour Anne, ravi de me connecter.';

describe('Envoi de demandes par Chrome', () => {
  let t: TestApp;
  let n = 0;

  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(async () => {
    await t.drop();
  });

  // Chaque test travaille dans son propre espace pour ne pas hériter d'un envoi ouvert.
  async function espace() {
    n++;
    const inst = await createInstance(t.owner.db, {
      slug: `env-${n}`,
      nom: `E${n}`,
      type: 'mandat',
    });
    const dans = <T>(fn: Parameters<typeof withInstance<T>>[2]) =>
      withInstance(t.app.db, inst.id, fn);
    const proposer = (i: number) =>
      dans((tx) =>
        ajouterProspect(tx, {
          lien: `https://www.linkedin.com/in/fictif-${n}-${i}`,
          nom: `Anne Fictive${i}`,
          entreprise: 'Atelier Fictif',
        }),
      );
    return { dans, proposer };
  }

  it('reconnaît les heures ouvrées de Paris', () => {
    expect(dansLesHeuresOuvrees(MERCREDI)).toBe(true);
    expect(dansLesHeuresOuvrees(SAMEDI)).toBe(false);
    expect(dansLesHeuresOuvrees(new Date('2026-11-25T05:00:00Z'))).toBe(false);
    expect(dansLesHeuresOuvrees(new Date('2026-11-25T17:30:00Z'))).toBe(false);
  });

  it('refuse une note vide, trop longue ou avec une variable non remplie', async () => {
    const { dans, proposer } = await espace();
    const p = await proposer(1);
    for (const note of ['  ', 'x'.repeat(301), 'Bonjour {prénom}']) {
      await expect(dans((tx) => demanderEnvoi(tx, p.id, note, MERCREDI))).rejects.toBeInstanceOf(
        EnvoiRefuse,
      );
    }
  });

  it('refuse un profil qui n’est pas « Proposé »', async () => {
    const { dans, proposer } = await espace();
    const p = await proposer(1);
    await dans((tx) =>
      tx.update(salesnavProspects).set({ statut: 'ecarte' }).where(eq(salesnavProspects.id, p.id)),
    );
    await expect(dans((tx) => demanderEnvoi(tx, p.id, NOTE, MERCREDI))).rejects.toThrow(/Proposé/);
  });

  it('démarre en essai à blanc et ne touche ni le prospect ni les compteurs', async () => {
    const { dans, proposer } = await espace();
    const p = await proposer(1);
    const envoi = await dans((tx) => demanderEnvoi(tx, p.id, NOTE, SAMEDI));
    expect(envoi.essai).toBe(true);
    const aFaire = await dans((tx) => recupererEnvoi(tx, MERCREDI));
    expect(aFaire).toMatchObject({ id: envoi.id, nom: 'Anne Fictive1', essaiABlanc: true });
    expect(await dans((tx) => recupererEnvoi(tx, MERCREDI))).toBeNull();
    const fin = await dans((tx) => rapporterEnvoi(tx, envoi.id, 'envoye', undefined, MERCREDI));
    expect(fin.statut).toBe('essai');
    const [apres] = await dans((tx) => listerProspects(tx));
    expect(apres?.statut).toBe('propose');
    expect((await dans((tx) => indicateurs(tx, MERCREDI))).jour.demande_envoyee).toBe(0);
  });

  it('refuse un second envoi tant que le premier est ouvert', async () => {
    const { dans, proposer } = await espace();
    const [a, b] = [await proposer(1), await proposer(2)];
    await dans((tx) => demanderEnvoi(tx, a.id, NOTE, MERCREDI));
    await expect(dans((tx) => demanderEnvoi(tx, b.id, NOTE, MERCREDI))).rejects.toThrow(
      /déjà en cours/,
    );
  });

  it('libère la file quand un envoi périmé n’a jamais été pris', async () => {
    const { dans, proposer } = await espace();
    const [a, b] = [await proposer(1), await proposer(2)];
    await dans((tx) => demanderEnvoi(tx, a.id, NOTE, MERCREDI));
    const plusTard = new Date(MERCREDI.getTime() + 20 * 60_000);
    await dans((tx) => demanderEnvoi(tx, b.id, NOTE, plusTard));
    const vus = await dans((tx) => derniersEnvois(tx, plusTard));
    expect(vus.find((e) => e.prospectId === a.id)?.statut).toBe('echec');
  });

  describe('envoi réel', () => {
    it('refuse hors des heures ouvrées', async () => {
      const { dans, proposer } = await espace();
      const p = await proposer(1);
      await dans((tx) => sauverReglages(tx, { essaiABlanc: false }));
      await expect(dans((tx) => demanderEnvoi(tx, p.id, NOTE, SAMEDI))).rejects.toThrow(/lundi/);
    });

    it('compte la demande, passe le prospect à « Demande envoyée » et marque l’origine Chrome', async () => {
      const { dans, proposer } = await espace();
      const p = await proposer(1);
      await dans((tx) => sauverReglages(tx, { essaiABlanc: false }));
      const envoi = await dans((tx) => demanderEnvoi(tx, p.id, NOTE, MERCREDI));
      expect(envoi.essai).toBe(false);
      await dans((tx) => recupererEnvoi(tx, MERCREDI));
      const fin = await dans((tx) => rapporterEnvoi(tx, envoi.id, 'envoye', undefined, MERCREDI));
      expect(fin.statut).toBe('envoye');
      const [apres] = await dans((tx) => listerProspects(tx));
      expect(apres?.statut).toBe('demande_envoyee');
      expect((await dans((tx) => indicateurs(tx, MERCREDI))).jour.demande_envoyee).toBe(1);
      await expect(
        dans((tx) => rapporterEnvoi(tx, envoi.id, 'envoye', undefined, MERCREDI)),
      ).rejects.toThrow(/terminé/);
    });

    it('impose deux minutes entre deux demandes', async () => {
      const { dans, proposer } = await espace();
      const [a, b] = [await proposer(1), await proposer(2)];
      await dans((tx) => sauverReglages(tx, { essaiABlanc: false, quotaJour: 5 }));
      const e = await dans((tx) => demanderEnvoi(tx, a.id, NOTE, MERCREDI));
      await dans((tx) => recupererEnvoi(tx, MERCREDI));
      await dans((tx) => rapporterEnvoi(tx, e.id, 'envoye', undefined, MERCREDI));
      const trop = new Date(MERCREDI.getTime() + 60_000);
      await expect(dans((tx) => demanderEnvoi(tx, b.id, NOTE, trop))).rejects.toThrow(/Patientez/);
      const ok = new Date(MERCREDI.getTime() + 130_000);
      await expect(dans((tx) => demanderEnvoi(tx, b.id, NOTE, ok))).resolves.toBeTruthy();
    });

    it('refuse au quota du jour', async () => {
      const { dans, proposer } = await espace();
      const [a, b] = [await proposer(1), await proposer(2)];
      await dans((tx) => sauverReglages(tx, { essaiABlanc: false, quotaJour: 1 }));
      const e = await dans((tx) => demanderEnvoi(tx, a.id, NOTE, MERCREDI));
      await dans((tx) => recupererEnvoi(tx, MERCREDI));
      await dans((tx) => rapporterEnvoi(tx, e.id, 'envoye', undefined, MERCREDI));
      const plusTard = new Date(MERCREDI.getTime() + 600_000);
      await expect(dans((tx) => demanderEnvoi(tx, b.id, NOTE, plusTard))).rejects.toThrow(/Quota/);
    });

    it('note « déjà connecté » sans rien compter', async () => {
      const { dans, proposer } = await espace();
      const p = await proposer(1);
      await dans((tx) => sauverReglages(tx, { essaiABlanc: false }));
      const e = await dans((tx) => demanderEnvoi(tx, p.id, NOTE, MERCREDI));
      await dans((tx) => recupererEnvoi(tx, MERCREDI));
      await dans((tx) => rapporterEnvoi(tx, e.id, 'deja_connecte', undefined, MERCREDI));
      const [apres] = await dans((tx) => listerProspects(tx));
      expect(apres?.statut).toBe('connecte');
      expect((await dans((tx) => indicateurs(tx, MERCREDI))).jour.demande_envoyee).toBe(0);
    });

    it('laisse le prospect « Proposé » quand le nom ne correspond pas', async () => {
      const { dans, proposer } = await espace();
      const p = await proposer(1);
      await dans((tx) => sauverReglages(tx, { essaiABlanc: false }));
      const e = await dans((tx) => demanderEnvoi(tx, p.id, NOTE, MERCREDI));
      await dans((tx) => recupererEnvoi(tx, MERCREDI));
      const fin = await dans((tx) =>
        rapporterEnvoi(tx, e.id, 'nom_different', 'Autre personne', MERCREDI),
      );
      expect(fin.statut).toBe('echec');
      expect(fin.detail).toContain('Autre personne');
      const [apres] = await dans((tx) => listerProspects(tx));
      expect(apres?.statut).toBe('propose');
    });
  });

  it('met le canal en pause sept jours sur un avertissement de LinkedIn, puis le reprend', async () => {
    const { dans, proposer } = await espace();
    const [a, b] = [await proposer(1), await proposer(2)];
    const e = await dans((tx) => demanderEnvoi(tx, a.id, NOTE, MERCREDI));
    await dans((tx) => recupererEnvoi(tx, MERCREDI));
    await dans((tx) => rapporterEnvoi(tx, e.id, 'avertissement', 'Limite atteinte', MERCREDI));
    const r = await dans((tx) => lireReglages(tx, MERCREDI));
    expect(r.pause).toBe(true);
    expect(r.pauseRaison).toMatch(/avertissement/);
    await expect(dans((tx) => demanderEnvoi(tx, b.id, NOTE, MERCREDI))).rejects.toThrow(/pause/);
    const dansHuitJours = new Date(MERCREDI.getTime() + 8 * 24 * 3600_000);
    expect((await dans((tx) => lireReglages(tx, dansHuitJours))).pause).toBe(false);
    await dans((tx) => sauverReglages(tx, { pause: false }));
    expect((await dans((tx) => lireReglages(tx, MERCREDI))).pause).toBe(false);
  });

  it('alerte quand le taux d’acceptation est bas sur un échantillon suffisant', async () => {
    const { dans } = await espace();
    expect(await dans((tx) => alerteAcceptation(tx, MERCREDI))).toBeNull();
    const ancien = new Date(MERCREDI.getTime() - 10 * 24 * 3600_000);
    await dans(async (tx) => {
      for (let i = 0; i < 24; i++) {
        const p = await ajouterProspect(tx, {
          lien: `https://www.linkedin.com/in/alerte-${n}-${i}`,
          nom: `Personne Fictive${i}`,
        });
        await tx
          .update(salesnavProspects)
          .set({
            statut: 'demande_envoyee',
            demandeLe: ancien,
            ...(i < 3 ? { accepteLe: MERCREDI } : {}),
          })
          .where(eq(salesnavProspects.id, p.id));
      }
    });
    const alerte = await dans((tx) => alerteAcceptation(tx, MERCREDI));
    expect(alerte?.echantillon).toBe(24);
    expect(alerte?.message).toMatch(/13 %/);
  });
});
