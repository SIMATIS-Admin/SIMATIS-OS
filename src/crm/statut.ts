import { sql } from 'drizzle-orm';
import { currentInstance } from '../db/columns.js';

export type StatutCommercial = 'suspect' | 'prospect' | 'client';

// Statut déduit des données, jamais saisi : client = une affaire gagnée, prospect = un rendez-vous
// commercial lié, suspect = le reste. Le rendez-vous est ce qui fait passer de suspect à prospect.
// `contactIds` et `entrepriseId` sont les références SQL de la ligne affichée (dans une sous-requête
// le "id" nu serait résolu sur la mauvaise table).
const statutSql = (contactEgal: string, entrepriseEgal: string) => sql`(case
  when exists (select 1 from opportunites o
    where o.instance_id = ${currentInstance} and o.clos = 'gagne'
      and (o.contact_id ${sql.raw(contactEgal)} or o.entreprise_id ${sql.raw(entrepriseEgal)}))
    then 'client'
  when exists (select 1 from rendez_vous r
    where r.instance_id = ${currentInstance} and r.statut = 'rdv' and (
      exists (select 1 from rdv_contacts x
        where x.rendez_vous_id = r.id and x.contact_id ${sql.raw(contactEgal)})
      or exists (select 1 from rdv_entreprises x
        where x.rendez_vous_id = r.id and x.entreprise_id ${sql.raw(entrepriseEgal)})
      or exists (select 1 from rdv_affaires x join opportunites o on o.id = x.opportunite_id
        where x.rendez_vous_id = r.id
          and (o.contact_id ${sql.raw(contactEgal)} or o.entreprise_id ${sql.raw(entrepriseEgal)}))))
    then 'prospect'
  else 'suspect' end)`;

// Pour une ligne de la liste des contacts.
export const statutContactSql = () =>
  statutSql(`= "contacts"."id"`, `= "contacts"."entreprise_id"`);

// Pour une ligne de la liste des entreprises : ses contacts comptent comme elle.
export const statutEntrepriseSql = () =>
  statutSql(
    `in (select c.id from contacts c where c.entreprise_id = "entreprises"."id")`,
    `= "entreprises"."id"`,
  );
