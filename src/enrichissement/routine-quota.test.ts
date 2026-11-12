import { expect, it, vi } from 'vitest';
import { setupTestApp } from '../../test/database.js';
import { createInstance } from '../instances/service.js';
import type { LimitesIA } from '../ia/limites.js';
import { ErreurIA } from './client.js';
import { dernieresSessions } from './sessions.js';
import { enregistrerRoutineRecherche, lireRoutineRecherche, tournerRecherche } from './routine.js';

// Instants du 3 novembre 2026 (heure d'hiver : Paris = UTC + 1).
const A_10H = new Date('2026-11-03T09:00:00Z');
const APRES_RENOUVELLEMENT = new Date('2026-11-03T11:40:00Z');
const limites = (restant: number): LimitesIA => ({
  actualiseLe: '2026-11-03T08:50:00Z',
  fournisseurs: [
    { id: 'claude', nom: 'Claude', etat: 'ok', plan: 'Pro', fenetre5h: null, hebdomadaire: null },
    {
      id: 'chatgpt',
      nom: 'ChatGPT',
      etat: 'ok',
      plan: 'plus',
      fenetre5h: { restant, reinitialiseLe: '2026-11-03T11:30:00Z' },
      hebdomadaire: null,
    },
  ],
});
const contacts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    entreprise: `Atelier Fictif ${i}`,
    prenom: 'Alice',
    nom: `Martin ${i}`,
    fonction: 'Dirigeante',
    email: null,
    linkedin: `https://www.linkedin.com/in/alice-fictive-${i}`,
    source: 'https://exemple.test/equipe',
    qualification: 'Industrie',
  }));

async function monter(slug: string) {
  const t = await setupTestApp();
  const instance = await createInstance(t.owner.db, { slug, nom: 'Test', type: 'propre' });
  await enregistrerRoutineRecherche(t.app.db, instance.id, {
    active: true,
    consignes: 'PME fictives',
    nombre: 3,
    heure: '09:00',
  });
  return { t, instance };
}

it('n’entame pas la journée quand le quota ChatGPT est presque épuisé, puis cherche après son renouvellement', async () => {
  const { t, instance } = await monter('quota-attente');
  try {
    const demander = vi.fn(() => Promise.resolve({ json: { contacts: contacts(3) }, jetons: 0 }));
    let quota = limites(2);
    const lire = () => Promise.resolve(quota);
    await tournerRecherche(t.app.db, { demander }, A_10H, lire);
    await tournerRecherche(t.app.db, { demander }, new Date(A_10H.getTime() + 60_000), lire);
    expect(demander).not.toHaveBeenCalled();
    const attente = await lireRoutineRecherche(t.app.db, instance.id);
    expect(attente.dernierJour).toBeUndefined();
    expect(attente.bilan).toBe('Quota ChatGPT presque épuisé (2 % restant). Nouvel essai à 12:31.');
    // La fenêtre est renouvelée : la mesure d'avant ne compte plus, la recherche part.
    quota = limites(2);
    await tournerRecherche(t.app.db, { demander }, APRES_RENOUVELLEMENT, lire);
    expect(demander).toHaveBeenCalled();
    expect((await lireRoutineRecherche(t.app.db, instance.id)).dernierJour).toBe('2026-11-03');
  } finally {
    await t.drop();
  }
});

it('rouvre la journée quand Codex échoue avec un quota bas, au plus une fois', async () => {
  const { t, instance } = await monter('quota-echec');
  try {
    const demander = vi.fn(() =>
      Promise.reject(new ErreurIA('La recherche Codex a échoué sur le Mac.', true)),
    );
    // Le quota semblait suffisant au départ, il est bas quand Codex échoue.
    const lectures = [limites(40), limites(1)];
    const lire = () => Promise.resolve(lectures.shift() ?? limites(1));
    await tournerRecherche(t.app.db, { demander }, A_10H, lire);
    const apresPremier = await lireRoutineRecherche(t.app.db, instance.id);
    expect(apresPremier.dernierJour).toBeUndefined();
    expect(apresPremier.essais).toEqual({ jour: '2026-11-03', n: 1 });
    expect(apresPremier.bilan).toContain('Quota ChatGPT presque épuisé');
    expect((await dernieresSessions(t.app.db, instance.id))[0]).toMatchObject({
      etat: 'erreur',
      detail: 'Quota ChatGPT presque épuisé.',
    });
    // Après le renouvellement : second essai, qui échoue encore avec un quota bas → journée close.
    const lectures2 = [limites(60), limites(1)].map((l) => ({
      ...l,
      fournisseurs: l.fournisseurs.map((f) =>
        f.fenetre5h
          ? { ...f, fenetre5h: { ...f.fenetre5h, reinitialiseLe: '2026-11-03T16:30:00Z' } }
          : f,
      ),
      actualiseLe: '2026-11-03T11:35:00Z',
    }));
    await tournerRecherche(t.app.db, { demander }, APRES_RENOUVELLEMENT, () =>
      Promise.resolve(lectures2.shift() ?? lectures2[0]!),
    );
    const final = await lireRoutineRecherche(t.app.db, instance.id);
    expect(final.dernierJour).toBe('2026-11-03');
    expect(final.essais).toEqual({ jour: '2026-11-03', n: 2 });
  } finally {
    await t.drop();
  }
});

it('dit la cause réelle et clôt la journée quand le quota n’est pas en cause', async () => {
  const { t, instance } = await monter('quota-cause');
  try {
    const demander = vi.fn(() =>
      Promise.reject(new ErreurIA('La recherche Codex a échoué sur le Mac.', true)),
    );
    await tournerRecherche(t.app.db, { demander }, A_10H, () => Promise.resolve(limites(80)));
    const r = await lireRoutineRecherche(t.app.db, instance.id);
    expect(r.dernierJour).toBe('2026-11-03');
    expect(r.bilan).toContain('Codex a échoué sur le Mac, sans en donner la cause');
    expect((await dernieresSessions(t.app.db, instance.id))[0]?.detail).toBe(
      'La recherche Codex a échoué sur le Mac.',
    );
    // Sans lecture des limites (compteur absent), le comportement reste celui d'avant : un seul essai.
    await tournerRecherche(t.app.db, { demander }, new Date(A_10H.getTime() + 3_600_000));
    expect(demander).toHaveBeenCalledTimes(1);
  } finally {
    await t.drop();
  }
});
