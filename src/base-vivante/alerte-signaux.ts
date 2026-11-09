import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { deposerSujet } from '../inbox/depot.js';
import { jourDe } from '../pilotage/realisees.js';
import { preferences } from '../preferences/schema.js';
import { ErreurBodacc, type ClientBodacc } from '../signaux/bodacc.js';
import { baseEntreprises } from './schema.js';
import { lireEtRanger, type SignalAjoute } from './signaux.js';

export const reglagesAlerte = z.object({
  active: z.boolean(),
  heure: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
});
export type ReglagesAlerte = z.infer<typeof reglagesAlerte>;
export type RoutineAlerte = ReglagesAlerte & { dernierJour?: string; bilan?: string };

const defaut: ReglagesAlerte = { active: false, heure: '08:00' };
const prefixe = 'routine-signaux-base:';
const cle = (instanceId: string) => prefixe + instanceId;

// A scheduled pass reads this many companies, the least recently checked first: a larger base
// is covered over several days rather than in one long run.
export const LIMITE_PASSAGE = 200;
// The first reading of a company brings its whole history: only what is recent is worth telling.
const JOURS_RECENTS = 14;

export async function lireRoutineAlerte(db: Database, instanceId: string): Promise<RoutineAlerte> {
  const [ligne] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.utilisateur, cle(instanceId)));
  return ligne?.options.signauxBase ?? defaut;
}

export async function enregistrerRoutineAlerte(
  db: Database,
  instanceId: string,
  reglages: ReglagesAlerte,
): Promise<RoutineAlerte> {
  await db
    .insert(preferences)
    .values({ utilisateur: cle(instanceId), favoris: [], options: { signauxBase: reglages } })
    .onConflictDoUpdate({
      target: preferences.utilisateur,
      set: {
        options: sql`jsonb_build_object('signauxBase', coalesce(${preferences.options}->'signauxBase', '{}'::jsonb) || ${JSON.stringify(reglages)}::jsonb)`,
      },
    });
  return lireRoutineAlerte(db, instanceId);
}

export type RapportAlerte = {
  verifiees: number;
  nouveaux: number;
  deposes: number;
  echecs: number;
};

const date = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR');

// Reads the BODACC for the companies of the base and drops in the Inbox what is worth a call:
// a procedure or a removal (priority 4), a sale of the business (3). Information is stored but
// never announced. A subject already dropped is never dropped again, even once handled.
export async function lancerAlerte(
  db: Database,
  bodacc: ClientBodacc,
  instanceId: string,
  { maintenant = new Date(), limite = LIMITE_PASSAGE }: { maintenant?: Date; limite?: number } = {},
): Promise<RapportAlerte> {
  const entreprises = await withInstance(db, instanceId, (tx) =>
    tx
      .select({ id: baseEntreprises.id })
      .from(baseEntreprises)
      .where(eq(baseEntreprises.instanceId, instanceId))
      .orderBy(sql`${baseEntreprises.signauxLe} asc nulls first`, asc(baseEntreprises.id))
      .limit(limite),
  );
  const seuil = new Date(maintenant.getTime() - JOURS_RECENTS * 864e5).toISOString().slice(0, 10);
  const rapport: RapportAlerte = { verifiees: 0, nouveaux: 0, deposes: 0, echecs: 0 };
  for (const { id } of entreprises) {
    let lu: Awaited<ReturnType<typeof lireEtRanger>>;
    try {
      lu = await lireEtRanger(db, bodacc, instanceId, id);
    } catch (e) {
      if (!(e instanceof ErreurBodacc)) throw e;
      rapport.echecs++;
      continue;
    }
    rapport.verifiees++;
    rapport.nouveaux += lu.ajoutes.length;
    for (const s of lu.ajoutes) {
      if (s.gravite === 'info' || (!lu.dejaVerifiee && s.date < seuil)) continue;
      const depose = await withInstance(db, instanceId, (tx) =>
        deposerSujet(tx, {
          type: 'autre',
          titre: `BODACC : ${lu.nom}, ${s.nature}`,
          resume: resume(s),
          origine: 'os',
          source: 'bodacc',
          sourceId: `${id}:${s.sourceId ?? s.id}`,
          lien: s.url,
          priorite: s.gravite === 'alerte' ? 4 : 3,
        }),
      );
      if (depose.statut === 'cree') rapport.deposes++;
    }
  }
  return rapport;
}

const resume = (s: SignalAjoute): string =>
  [`${s.famille}, annonce du ${date(s.date)}.`, s.detail].filter(Boolean).join(' ');

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

export function bilanDe(r: RapportAlerte): string {
  return (
    [
      `${pluriel(r.verifiees, 'entreprise')} ${r.verifiees > 1 ? 'vérifiées' : 'vérifiée'}`,
      `${pluriel(r.nouveaux, 'nouvelle')} annonce${r.nouveaux > 1 ? 's' : ''}`,
      `${pluriel(r.deposes, 'sujet')} dans l’Inbox`,
      ...(r.echecs > 0
        ? [`${r.echecs} non lue${r.echecs > 1 ? 's' : ''} (BODACC indisponible)`]
        : []),
    ].join(', ') + '.'
  );
}

// Called every minute by the server, like the other daily routines: runs once a day, from the
// chosen hour (Paris time) on.
export async function tournerAlertes(db: Database, bodacc: ClientBodacc, maintenant = new Date()) {
  const jour = jourDe(maintenant);
  const heure = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(maintenant);
  const lignes = await db
    .select()
    .from(preferences)
    .where(sql`${preferences.utilisateur} like ${prefixe + '%'}`);
  for (const ligne of lignes) {
    const routine = ligne.options.signauxBase;
    if (!routine?.active || routine.heure > heure || routine.dernierJour === jour) continue;
    // Taking the day first: two servers, or two ticks, never run the same pass twice.
    const [prise] = await db
      .update(preferences)
      .set({
        options: {
          signauxBase: { ...routine, dernierJour: jour, bilan: 'Vérification en cours…' },
        },
      })
      .where(
        and(
          eq(preferences.utilisateur, ligne.utilisateur),
          sql`${preferences.options} = ${JSON.stringify(ligne.options)}::jsonb`,
        ),
      )
      .returning({ utilisateur: preferences.utilisateur });
    if (!prise) continue;
    const instanceId = ligne.utilisateur.slice(prefixe.length);
    let bilan: string;
    try {
      bilan = bilanDe(await lancerAlerte(db, bodacc, instanceId, { maintenant }));
    } catch {
      bilan = 'La vérification a échoué ; elle reprendra demain.';
    }
    await db
      .update(preferences)
      .set({ options: { signauxBase: { ...routine, dernierJour: jour, bilan } } })
      .where(eq(preferences.utilisateur, ligne.utilisateur));
  }
}
