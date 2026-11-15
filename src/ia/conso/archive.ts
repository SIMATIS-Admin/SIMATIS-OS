import { asc, eq, inArray, lt, notExists, sql } from 'drizzle-orm';
import type { Database } from '../../db.js';
import { jourDe } from '../../pilotage/realisees.js';
import { lignesHeures } from './console.js';
import {
  iaArchive,
  iaArchiveJours,
  iaCumuls,
  iaJauges,
  iaLancements,
  iaReleve,
  iaSessions,
} from './schema.js';

const HEURE_MS = 3_600_000;
const JOUR_MS = 24 * HEURE_MS;
const RATTRAPAGE_JOURS = 30;
const CONSERVATION_ARCHIVE_MOIS = 13;
const CONSERVATION_JOURS = 90;
// La veille n'est figée qu'après 1 h du matin : les derniers relevés de la nuit ont eu le temps
// d'arriver (le relevé du Mac passe toutes les 5 minutes).
const HEURE_ARCHIVE = 1;

const heureParis = (d: Date) =>
  Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(d),
  );

// Début (UTC) d'une journée de Paris : les décalages de Paris sont des heures entières.
function debutJourParis(jour: string): Date {
  const minuit = Date.parse(`${jour}T00:00:00.000Z`);
  for (let t = minuit - 3 * HEURE_MS; t <= minuit + 3 * HEURE_MS; t += HEURE_MS) {
    const d = new Date(t);
    if (jourDe(d) === jour && heureParis(d) === 0) return d;
  }
  throw new Error(`Début de journée introuvable : ${jour}`);
}

const jourSuivant = (jour: string) =>
  new Date(Date.parse(`${jour}T12:00:00.000Z`) + JOUR_MS).toISOString().slice(0, 10);

// Une journée n'est figée que si le relevé du Mac est passé après sa fin (plus une marge) :
// Mac éteint ou exécuteur arrêté, elle attend au lieu d'être figée incomplète pour toujours.
const MARGE_RELEVE_MS = 10 * 60_000;

async function joursAArchiver(db: Database, maintenant: Date): Promise<string[]> {
  const aujourdhui = jourDe(maintenant);
  const [releve] = await db.select().from(iaReleve).where(eq(iaReleve.id, 'mac'));
  if (!releve) return [];
  const [premier] = await db
    .select({ heure: iaCumuls.heure })
    .from(iaCumuls)
    .orderBy(asc(iaCumuls.heure))
    .limit(1);
  if (!premier) return [];
  const plusTot = jourDe(new Date(maintenant.getTime() - RATTRAPAGE_JOURS * JOUR_MS));
  let jour = jourDe(premier.heure) > plusTot ? jourDe(premier.heure) : plusTot;
  const derniers =
    heureParis(maintenant) >= HEURE_ARCHIVE
      ? aujourdhui
      : jourDe(new Date(maintenant.getTime() - JOUR_MS));
  const candidats: string[] = [];
  for (; jour < derniers; jour = jourSuivant(jour)) {
    const fin = debutJourParis(jourSuivant(jour)).getTime();
    if (releve.dernierPassage.getTime() < fin + MARGE_RELEVE_MS) break;
    candidats.push(jour);
  }
  if (candidats.length === 0) return [];
  const faits = await db
    .select({ jour: iaArchiveJours.jour })
    .from(iaArchiveJours)
    .where(inArray(iaArchiveJours.jour, candidats));
  const dejaFaits = new Set(faits.map((f) => f.jour));
  return candidats.filter((j) => !dejaFaits.has(j));
}

export async function archiverEtPurger(
  db: Database,
  maintenant: Date,
): Promise<{ jours: string[] }> {
  const jours = await joursAArchiver(db, maintenant);
  for (const jour of jours) {
    const debut = debutJourParis(jour);
    const fin = new Date(debutJourParis(jourSuivant(jour)).getTime() - 1);
    const lignes = await lignesHeures(db, debut, fin, maintenant);
    await db.transaction(async (tx) => {
      if (lignes.length > 0)
        await tx
          .insert(iaArchive)
          .values(
            lignes.map((l) => ({
              jour,
              heure: l.heure,
              origine: l.origine,
              fournisseur: l.fournisseur,
              outil: l.outil,
              sujet: l.sujet,
              ...l.jetons,
              cout: l.cout,
              l5: l.l5,
              lh: l.lh,
              estime: l.estime,
            })),
          )
          .onConflictDoNothing();
      await tx.insert(iaArchiveJours).values({ jour }).onConflictDoNothing();
    });
  }

  const limiteArchive = new Date(maintenant);
  limiteArchive.setUTCMonth(limiteArchive.getUTCMonth() - CONSERVATION_ARCHIVE_MOIS);
  const limite = new Date(maintenant.getTime() - CONSERVATION_JOURS * JOUR_MS);
  await db.delete(iaArchive).where(lt(iaArchive.jour, jourDe(limiteArchive)));
  await db.delete(iaArchiveJours).where(lt(iaArchiveJours.jour, jourDe(limiteArchive)));
  await db.delete(iaCumuls).where(lt(iaCumuls.heure, limite));
  await db.delete(iaJauges).where(lt(iaJauges.at, limite));
  await db.delete(iaLancements).where(lt(iaLancements.debut, limite));
  await db.delete(iaSessions).where(
    notExists(
      db
        .select({ un: sql`1` })
        .from(iaCumuls)
        .where(sql`${iaCumuls.sessionId} = ${iaSessions.id}`),
    ),
  );
  return { jours };
}
