import { logEvent } from '../journal/service.js';
import { and, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';
import type { ConnexionDeps } from '../connexions/service.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { envoyerMail, mailRelance, type EnvoiInvitation } from './invitations.js';
import { vmaTests } from './schema.js';

export class RelanceImpossible extends Error {}

// Deux relances à moins d'une minute sont un double clic, pas une seconde relance.
const DOUBLON_MS = 60_000;

// Seul chemin de relance : le bouton et le passage quotidien l'appellent. Le verrou de ligne
// empêche deux relances simultanées. Une simulation ne compte pas ; un échec est consigné.
export async function relancerInvitation(
  db: Database,
  instance: Instance,
  ecriture: ConnexionDeps,
  p: {
    testId: string;
    origine: 'manuelle' | 'auto';
    tutoiement?: boolean;
    maintenant?: Date;
  },
): Promise<EnvoiInvitation> {
  const maintenant = p.maintenant ?? new Date();
  return withInstance(db, instance.id, async (tx) => {
    const [test] = await tx
      .select()
      .from(vmaTests)
      .where(and(eq(vmaTests.instanceId, instance.id), eq(vmaTests.id, p.testId)))
      .for('update');
    if (!test) throw new RelanceImpossible('Invitation introuvable dans cette instance');
    if (test.statut !== 'envoyee' || test.recueLe || test.ecran)
      throw new RelanceImpossible('Seule une invitation ouverte peut être relancée');
    if (test.expireLe <= maintenant)
      throw new RelanceImpossible('Invitation expirée : créez-en une nouvelle');
    if (!test.contactEmail) throw new RelanceImpossible('Aucune adresse e-mail pour ce contact');
    const derniere = test.relances.at(-1);
    if (derniere && maintenant.getTime() - new Date(derniere.le).getTime() < DOUBLON_MS)
      throw new RelanceImpossible('Relance déjà envoyée à l’instant');

    const tutoiement = p.tutoiement ?? test.tutoiement;
    const envoi = await envoyerMail(tx, instance, ecriture, {
      to: test.contactEmail,
      message: mailRelance({
        entrepriseNom: test.entrepriseNom,
        contactNom: test.contactNom,
        lien: test.lien,
        expireLe: test.expireLe,
        tutoiement,
      }),
    });
    await tx
      .update(vmaTests)
      .set({
        tutoiement,
        updatedAt: new Date(),
        ...(envoi.statut === 'envoye'
          ? {
              relances: [...test.relances, { le: maintenant.toISOString(), origine: p.origine }],
              echecEnvoi: null,
            }
          : {}),
        ...(envoi.statut === 'echec' ? { echecEnvoi: envoi.raison ?? 'échec' } : {}),
      })
      .where(and(eq(vmaTests.instanceId, instance.id), eq(vmaTests.id, test.id)));
    if (p.origine === 'manuelle') {
      const action =
        envoi.statut === 'envoye'
          ? `Relance envoyée à ${test.contactEmail}.`
          : envoi.statut === 'simule'
            ? 'Relance non envoyée (simulation).'
            : `Relance non envoyée${envoi.raison ? ` : ${envoi.raison}` : ''}.`;
      await logEvent(tx, { acteur: 'pilote', action });
    }
    return envoi;
  });
}

export const RELANCE_AUTO_JOURS = 7;
export type ResultatRelancesAuto = { relancees: number; simulees: number; echecs: number };

// Une invitation envoyée depuis 7 jours ou plus, ni utilisée, ni expirée, jamais relancée (ni à
// la main ni automatiquement), reçoit une relance. Chaque ligne est isolée : un échec n'arrête pas
// le passage.
export async function relancerEnAttente(
  db: Database,
  ecriture: ConnexionDeps,
  maintenant = new Date(),
): Promise<ResultatRelancesAuto> {
  const compte: ResultatRelancesAuto = { relancees: 0, simulees: 0, echecs: 0 };
  const limite = new Date(maintenant.getTime() - RELANCE_AUTO_JOURS * 24 * 3600 * 1000);
  for (const instance of await listInstances(db)) {
    const candidates = await withInstance(db, instance.id, (tx) =>
      tx
        .select({ id: vmaTests.id })
        .from(vmaTests)
        .where(
          and(
            eq(vmaTests.instanceId, instance.id),
            eq(vmaTests.statut, 'envoyee'),
            eq(vmaTests.relanceAuto, true),
            gt(vmaTests.expireLe, maintenant),
            isNotNull(vmaTests.contactEmail),
            lte(vmaTests.envoyeeLe, limite),
            sql`jsonb_array_length(${vmaTests.relances}) = 0`,
          ),
        ),
    );
    for (const { id } of candidates) {
      try {
        const envoi = await relancerInvitation(db, instance, ecriture, {
          testId: id,
          origine: 'auto',
          maintenant,
        });
        if (envoi.statut === 'envoye') compte.relancees++;
        else if (envoi.statut === 'simule') compte.simulees++;
        else compte.echecs++;
      } catch {
        compte.echecs++;
      }
    }
  }
  return compte;
}

const parisDe = (date: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('fr-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { jour: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour) };
};

// Passage quotidien : un contrôle par heure, la relance part au premier contrôle à partir de 8 h
// (Paris), une fois par jour. Idempotent, donc un redémarrage du serveur ne relance rien de plus.
export function startRelancesVma(
  db: Database,
  deps: {
    ecriture: ConnexionDeps;
    tickMs?: number;
    maintenant?: () => Date;
    onResult?: (r: ResultatRelancesAuto) => void;
    onError?: (error: unknown) => void;
  },
): () => void {
  let enCours = false;
  let dernierJour = '';
  const tick = () => {
    const { jour, heure } = parisDe(deps.maintenant?.() ?? new Date());
    if (enCours || heure < 8 || jour === dernierJour) return;
    enCours = true;
    relancerEnAttente(db, deps.ecriture, deps.maintenant?.())
      .then((r) => {
        dernierJour = jour;
        deps.onResult?.(r);
      })
      .catch((error: unknown) => deps.onError?.(error))
      .finally(() => {
        enCours = false;
      });
  };
  const timer = setInterval(tick, deps.tickMs ?? 3_600_000);
  tick();
  return () => clearInterval(timer);
}
