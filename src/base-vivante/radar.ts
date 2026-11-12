import { and, asc, count, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import { baseVivante } from './schema.js';

export type FicheRadar = {
  id: string;
  entreprise: string;
  nom: string;
  fonction: string | null;
  nbContacts: number;
  dernierContactLe: string | null;
};
export type ColonneRadar = { total: number; fiches: FicheRadar[] };
export type EtatRadar = {
  aEnrichir: ColonneRadar;
  prets: ColonneRadar;
  contactes: ColonneRadar;
  ontRepondu: ColonneRadar;
};

// Une fiche opposée ou exclue n'est jamais proposée à la prospection.
const exploitable = (): SQL[] => [
  eq(baseVivante.opposition, false),
  isNull(baseVivante.exclusion),
  sql`trim(${baseVivante.nom}) <> ''`,
];

// Les quatre premières étapes du Radar, lues dans la base vivante (zone et statut de prospection).
// La cinquième, le rendez-vous accepté, vient du CRM : la fiche est alors devenue un contact.
export async function etatRadar(db: Executor, instanceId: string, limite = 5): Promise<EtatRadar> {
  return withInstance(db, instanceId, async (tx) => {
    const colonne = async (conditions: SQL[]): Promise<ColonneRadar> => {
      const filtre = and(eq(baseVivante.instanceId, instanceId), ...conditions);
      const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(baseVivante).where(filtre);
      const lignes = await tx
        .select({
          id: baseVivante.id,
          entreprise: baseVivante.entreprise,
          prenom: baseVivante.prenom,
          nom: baseVivante.nom,
          fonction: baseVivante.fonction,
          nbContacts: baseVivante.nbContacts,
          dernierContactLe: baseVivante.dernierContactLe,
        })
        .from(baseVivante)
        .where(filtre)
        .orderBy(asc(baseVivante.entreprise), asc(baseVivante.nom), asc(baseVivante.id))
        .limit(limite);
      return {
        total: n,
        fiches: lignes.map((l) => ({
          id: l.id,
          entreprise: l.entreprise,
          nom: [l.prenom, l.nom].filter(Boolean).join(' '),
          fonction: l.fonction,
          nbContacts: l.nbContacts,
          dernierContactLe: l.dernierContactLe?.toISOString() ?? null,
        })),
      };
    };
    return {
      aEnrichir: await colonne([eq(baseVivante.zone, 'a_enrichir')]),
      prets: await colonne([
        ...exploitable(),
        eq(baseVivante.zone, 'prospectable'),
        eq(baseVivante.statutProspection, 'jamais_contacte'),
        eq(baseVivante.emailInvalide, false),
      ]),
      contactes: await colonne([...exploitable(), eq(baseVivante.statutProspection, 'contacte')]),
      ontRepondu: await colonne([...exploitable(), eq(baseVivante.statutProspection, 'a_repondu')]),
    };
  });
}
