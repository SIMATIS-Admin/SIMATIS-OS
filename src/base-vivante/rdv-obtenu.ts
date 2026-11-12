import { sql } from 'drizzle-orm';
import { baseVivante } from './schema.js';

// Vrai quand la personne de la fiche a obtenu un rendez-vous commercial : elle est un contact du
// CRM (lié à la fiche, ou de même e-mail) qui a un rendez-vous, ou dont l'entreprise en a un. Elle
// n'est alors plus un suspect : la séquence à froid s'arrête et le Radar ne la compte plus avant
// le rendez-vous.
export const rdvObtenu = sql`exists (
  select 1 from contacts c
  where c.instance_id = ${baseVivante.instanceId}
    and (
      c.id = ${baseVivante.crmContactId}
      or (nullif(trim(c.email), '') is not null
        and lower(trim(c.email)) = lower(trim(${baseVivante.email})))
    )
    and (
      exists (
        select 1 from rdv_contacts rc join rendez_vous r on r.id = rc.rendez_vous_id
        where rc.contact_id = c.id and r.statut = 'rdv'
      )
      or (c.entreprise_id is not null and exists (
        select 1 from rdv_entreprises re join rendez_vous r on r.id = re.rendez_vous_id
        where re.entreprise_id = c.entreprise_id and r.statut = 'rdv'
      ))
    )
)`;
