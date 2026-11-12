import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { contacts } from '../crm/schema.js';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import { baseVivante } from './schema.js';

export type SuspectBase = {
  id: string;
  nom: string;
  entreprise: string;
  fonction: string | null;
  email: string | null;
  telephone: string | null;
};

// Les fiches de la base vivante qui ne sont pas (encore) un contact du CRM de l'instance : ce sont
// les suspects. Une fiche sans personne (entreprise seule), opposée ou exclue n'est pas proposée.
// Une fiche entrée dans le CRM d'un autre mandat reste ici, puisqu'elle n'est pas dans celui-ci.
export async function listerSuspectsHorsCrm(
  db: Executor,
  instanceId: string,
  q = '',
): Promise<SuspectBase[]> {
  const recherche = q.trim();
  const motif = `%${recherche.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return withInstance(db, instanceId, async (tx) => {
    const lignes = await tx
      .select({
        id: baseVivante.id,
        prenom: baseVivante.prenom,
        nom: baseVivante.nom,
        entreprise: baseVivante.entreprise,
        fonction: baseVivante.fonction,
        email: baseVivante.email,
        telephone: baseVivante.telephone,
      })
      .from(baseVivante)
      .where(
        and(
          eq(baseVivante.instanceId, instanceId),
          sql`trim(${baseVivante.nom}) <> ''`,
          eq(baseVivante.opposition, false),
          isNull(baseVivante.exclusion),
          sql`(${baseVivante.crmContactId} is null or not exists (
            select 1 from ${contacts} c
            where c.id = ${baseVivante.crmContactId} and c.instance_id = ${instanceId}))`,
          recherche
            ? or(
                ilike(baseVivante.entreprise, motif),
                ilike(baseVivante.nom, motif),
                ilike(baseVivante.prenom, motif),
                ilike(baseVivante.email, motif),
              )
            : undefined,
        ),
      )
      .orderBy(asc(baseVivante.entreprise), asc(baseVivante.nom), asc(baseVivante.id))
      .limit(1000);
    return lignes.map((l) => ({
      id: l.id,
      nom: [l.prenom, l.nom].filter(Boolean).join(' '),
      entreprise: l.entreprise,
      fonction: l.fonction,
      email: l.email,
      telephone: l.telephone,
    }));
  });
}
