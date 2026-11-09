import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import { classer, ErreurBodacc, type ClientBodacc, type Gravite } from '../signaux/bodacc.js';
import { EntrepriseIntrouvable } from './entreprises.js';
import { baseEntreprises, baseSignaux } from './schema.js';

export const MAX_ACTUALISATION = 25;
// Notices older than this say little about the company today.
const MOIS_RETROSPECTIVE = 24;

export type SignalBase = {
  id: string;
  date: string;
  famille: string;
  nature: string;
  gravite: Gravite;
  detail: string | null;
  url: string | null;
};
export type SignauxEntreprise = { signaux: SignalBase[]; verifieLe: string | null };

const RANG = sql`case ${baseSignaux.gravite} when 'alerte' then 0 when 'attention' then 1 else 2 end`;

export async function lireSignaux(
  db: Executor,
  instanceId: string,
  entrepriseId: string,
): Promise<SignauxEntreprise> {
  return withInstance(db, instanceId, async (tx) => {
    const [e] = await tx
      .select({ signauxLe: baseEntreprises.signauxLe })
      .from(baseEntreprises)
      .where(and(eq(baseEntreprises.id, entrepriseId), eq(baseEntreprises.instanceId, instanceId)));
    if (!e) throw new EntrepriseIntrouvable('Entreprise introuvable');
    const signaux = await tx
      .select({
        id: baseSignaux.id,
        date: baseSignaux.date,
        famille: baseSignaux.famille,
        nature: baseSignaux.nature,
        gravite: baseSignaux.gravite,
        detail: baseSignaux.detail,
        url: baseSignaux.url,
      })
      .from(baseSignaux)
      .where(
        and(eq(baseSignaux.entrepriseId, entrepriseId), eq(baseSignaux.instanceId, instanceId)),
      )
      .orderBy(RANG, sql`${baseSignaux.date} desc`);
    return { signaux, verifieLe: e.signauxLe?.toISOString() ?? null };
  });
}

const depuis = (): string => {
  const d = new Date();
  d.setMonth(d.getMonth() - MOIS_RETROSPECTIVE);
  return d.toISOString().slice(0, 10);
};

// Reads the BODACC for one company and keeps what matters. A notice already known is not added
// twice. A BODACC that does not answer leaves the company as it was.
export async function actualiserSignaux(
  db: Executor,
  bodacc: ClientBodacc,
  instanceId: string,
  entrepriseId: string,
): Promise<number> {
  const [e] = await withInstance(db, instanceId, (tx) =>
    tx
      .select({ siren: baseEntreprises.siren })
      .from(baseEntreprises)
      .where(and(eq(baseEntreprises.id, entrepriseId), eq(baseEntreprises.instanceId, instanceId))),
  );
  if (!e) throw new EntrepriseIntrouvable('Entreprise introuvable');
  const signaux = (await bodacc.annonces(e.siren, depuis())).flatMap((a) => {
    const s = classer(a);
    return s ? [s] : [];
  });
  return withInstance(db, instanceId, async (tx) => {
    const nouveaux =
      signaux.length === 0
        ? []
        : await tx
            .insert(baseSignaux)
            .values(
              signaux.map((s) => ({
                instanceId,
                entrepriseId,
                source: 'bodacc',
                sourceId: s.sourceId,
                date: s.date,
                famille: s.famille,
                nature: s.nature,
                gravite: s.gravite,
                detail: s.detail,
                url: s.url,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: baseSignaux.id });
    await tx
      .update(baseEntreprises)
      .set({ signauxLe: new Date() })
      .where(and(eq(baseEntreprises.id, entrepriseId), eq(baseEntreprises.instanceId, instanceId)));
    return nouveaux.length;
  });
}

export type RapportSignaux = { verifiees: number; nouveaux: number; echecs: number };

export async function actualiserPlusieurs(
  db: Executor,
  bodacc: ClientBodacc,
  instanceId: string,
  ids: string[],
): Promise<RapportSignaux> {
  const uniques = [...new Set(ids)];
  const connues = await withInstance(db, instanceId, (tx) =>
    tx
      .select({ id: baseEntreprises.id })
      .from(baseEntreprises)
      .where(and(eq(baseEntreprises.instanceId, instanceId), inArray(baseEntreprises.id, uniques))),
  );
  const rapport: RapportSignaux = { verifiees: 0, nouveaux: 0, echecs: 0 };
  for (const { id } of connues) {
    try {
      rapport.nouveaux += await actualiserSignaux(db, bodacc, instanceId, id);
      rapport.verifiees++;
    } catch (e) {
      if (!(e instanceof ErreurBodacc)) throw e;
      rapport.echecs++;
    }
  }
  return rapport;
}
