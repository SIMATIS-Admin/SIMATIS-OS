import { and, asc, count, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import { prospectionSuiviFroid } from '../prospection/schema.js';
import { lireSequence, prochaineTouche } from '../prospection/sequence.js';
import { rdvObtenu } from './rdv-obtenu.js';
import { baseVivante } from './schema.js';
import { aEnrichir } from './service.js';

export type FicheRadar = {
  id: string;
  entreprise: string;
  nom: string;
  fonction: string | null;
  nbContacts: number;
  dernierContactLe: string | null;
  // Étiquettes de la fiche, dont celle de l'ICP d'où elle vient.
  tags: string[];
  // Date à partir de laquelle la touche suivante de la séquence peut partir ; null si aucune.
  prochaineRelanceLe: string | null;
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
  // Une personne qui a obtenu un rendez-vous est passée dans « RDV accepté » : plus dans la séquence.
  sql`not ${rdvObtenu}`,
];

// Touches de prospection à froid déjà envoyées à la fiche : le suivi de séquence les compte, alors
// que le statut de la fiche ne change qu'à la lecture de la messagerie.
const touchesEnvoyees = sql<number>`coalesce((select max(s.touches) from ${prospectionSuiviFroid} s
  where s.base_id = ${baseVivante.id}), 0)`;

// Les quatre premières étapes du Radar, lues dans la base vivante (zone et statut de prospection).
// La cinquième, le rendez-vous accepté, vient du CRM : la fiche est alors devenue un contact.
export async function etatRadar(db: Executor, instanceId: string, limite = 5): Promise<EtatRadar> {
  return withInstance(db, instanceId, async (tx) => {
    const { delais } = await lireSequence(tx, instanceId);
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
          nbContacts: sql<number>`greatest(${baseVivante.nbContacts}, ${touchesEnvoyees})`.mapWith(
            Number,
          ),
          dernierContactLe: baseVivante.dernierContactLe,
          tags: baseVivante.tags,
          touchesSuivi: prospectionSuiviFroid.touches,
          touchesMax: prospectionSuiviFroid.touchesMax,
          derniereLe: prospectionSuiviFroid.derniereLe,
        })
        .from(baseVivante)
        .leftJoin(
          prospectionSuiviFroid,
          and(
            eq(prospectionSuiviFroid.baseId, baseVivante.id),
            eq(prospectionSuiviFroid.instanceId, instanceId),
          ),
        )
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
          tags: l.tags,
          prochaineRelanceLe:
            l.touchesSuivi !== null && l.touchesMax !== null
              ? (prochaineTouche(
                  { touches: l.touchesSuivi, touchesMax: l.touchesMax, derniereLe: l.derniereLe },
                  delais,
                )?.toISOString() ?? null)
              : null,
        })),
      };
    };
    return {
      // Même définition que la liste des Bases vivantes : une entreprise dont un contact est déjà
      // joignable n'est plus « à enrichir ».
      aEnrichir: await colonne([aEnrichir]),
      prets: await colonne([
        ...exploitable(),
        eq(baseVivante.zone, 'prospectable'),
        eq(baseVivante.statutProspection, 'jamais_contacte'),
        sql`${touchesEnvoyees} = 0`,
        eq(baseVivante.emailInvalide, false),
      ]),
      contactes: await colonne([
        ...exploitable(),
        sql`(${baseVivante.statutProspection} = 'contacte'
          or (${baseVivante.statutProspection} = 'jamais_contacte' and ${touchesEnvoyees} > 0))`,
      ]),
      ontRepondu: await colonne([...exploitable(), eq(baseVivante.statutProspection, 'a_repondu')]),
    };
  });
}
