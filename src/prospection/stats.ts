import { and, eq, gte, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { taches } from '../crm/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { decaler, jourDe } from '../pilotage/realisees.js';
import { contactsAConfirmer } from './froid.js';
import { OBJECTIF_DEFAUT, prospectionOccurrences, prospectionReglages } from './schema.js';

export type StatsProspection = {
  jour: number;
  objectif: number;
  semaine: number;
  reponses: number;
  rdv: number;
  parTheme: Record<string, number>;
  parTouche: Record<string, number>;
  relancesFaites: number;
  relancesRestantes: number;
  // Contacts à froid ayant atteint leur nombre de touches, à confirmer comme « épuisés » (livraison 3).
  aConfirmer: number;
};

const JOUR_MS = 24 * 60 * 60_000;

// Chiffres de l'accueil Prospection et du Brief du jour. Jour = jour calendaire de Paris ; semaine =
// les 7 derniers jours avec aujourd'hui. Un brouillon n'est jamais compté : seul un mail parti l'est.
export async function statsProspection(
  tx: Executor,
  maintenant: Date = new Date(),
): Promise<StatsProspection> {
  const aujourdhui = jourDe(maintenant);
  const debutSemaine = decaler(aujourdhui, -6);

  const occurrences = await tx
    .select()
    .from(prospectionOccurrences)
    .where(
      and(
        eq(prospectionOccurrences.instanceId, currentInstance),
        ne(prospectionOccurrences.etat, 'brouillon'),
        isNotNull(prospectionOccurrences.envoyeAt),
        // Marge d'un jour : le calcul exact se fait par jour de Paris, ci-dessous.
        gte(prospectionOccurrences.envoyeAt, new Date(maintenant.getTime() - 8 * JOUR_MS)),
      ),
    );
  const semaine = occurrences.filter((o) => {
    const jour = o.envoyeAt ? jourDe(o.envoyeAt) : '';
    return jour >= debutSemaine && jour <= aujourdhui;
  });

  const parTheme: Record<string, number> = {};
  const parTouche: Record<string, number> = {};
  for (const o of semaine) {
    parTheme[o.theme] = (parTheme[o.theme] ?? 0) + 1;
    parTouche[String(o.touche)] = (parTouche[String(o.touche)] ?? 0) + 1;
  }

  const [reglage] = await tx
    .select({ objectifJour: prospectionReglages.objectifJour })
    .from(prospectionReglages)
    .where(eq(prospectionReglages.instanceId, currentInstance));

  const faites = await tx
    .select({ faitAt: taches.faitAt })
    .from(taches)
    .where(
      and(
        eq(taches.instanceId, currentInstance),
        eq(taches.canal, 'email'),
        gte(taches.faitAt, new Date(maintenant.getTime() - 2 * JOUR_MS)),
      ),
    );
  const ouvertes = await tx
    .select({ echeance: taches.echeance })
    .from(taches)
    .where(
      and(
        eq(taches.instanceId, currentInstance),
        eq(taches.canal, 'email'),
        isNull(taches.faitAt),
        isNotNull(taches.echeance),
        lt(taches.echeance, new Date(maintenant.getTime() + 2 * JOUR_MS)),
      ),
    );

  return {
    jour: semaine.filter((o) => o.envoyeAt && jourDe(o.envoyeAt) === aujourdhui).length,
    objectif: reglage?.objectifJour ?? OBJECTIF_DEFAUT,
    semaine: semaine.length,
    reponses: semaine.filter((o) => o.etat === 'reponse' || o.etat === 'rdv').length,
    rdv: semaine.filter((o) => o.etat === 'rdv').length,
    parTheme,
    parTouche,
    relancesFaites: faites.filter((f) => f.faitAt && jourDe(f.faitAt) === aujourdhui).length,
    relancesRestantes: ouvertes.filter((o) => o.echeance && jourDe(o.echeance) <= aujourdhui)
      .length,
    aConfirmer: (await contactsAConfirmer(tx)).length,
  };
}
