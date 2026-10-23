import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { activites, contacts } from '../crm/schema.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { listInstances } from '../instances/service.js';
import { majHistorique } from './integration.js';
import { baseVivante, type FicheBase } from './schema.js';

// Contacts of the OS count as « contacted » for these activity types (a note is not a contact).
const TYPES_CONTACT = ['email', 'appel', 'reunion'];
const LOT = 500;
export const MOIS_RECONTACT = 6;

export type ContactCrm = {
  mandat: string;
  dernierLe: Date | null;
  canal: string | null;
  nb: number;
};

// What every mandate's CRM knows about these addresses. Only the correspondence comes back (which
// mandate, when, how, how many times), never the content of the exchanges.
export async function historiqueCrm(
  db: Database,
  emails: string[],
): Promise<Map<string, ContactCrm[]>> {
  const resultat = new Map<string, ContactCrm[]>();
  if (emails.length === 0) return resultat;
  const types = sql.join(
    TYPES_CONTACT.map((t) => sql`${t}`),
    sql`, `,
  );
  for (const instance of await listInstances(db)) {
    const lignes = await withInstance(db, instance.id, (tx) =>
      tx
        .select({
          email: sql<string>`lower(${contacts.email})`,
          dernier: sql<Date | null>`max(${activites.at}) filter (where ${activites.type} in (${types}))`,
          canal: sql<
            string | null
          >`(array_agg(${activites.type} order by ${activites.at} desc) filter (where ${activites.type} in (${types})))[1]`,
          nb: sql<number>`(count(${activites.id}) filter (where ${activites.type} in (${types})))::int`,
        })
        .from(contacts)
        .leftJoin(
          activites,
          and(eq(activites.contactId, contacts.id), eq(activites.instanceId, instance.id)),
        )
        .where(
          and(
            eq(contacts.instanceId, instance.id),
            sql`lower(${contacts.email}) in (${sql.join(
              emails.map((e) => sql`${e}`),
              sql`, `,
            )})`,
          ),
        )
        .groupBy(sql`lower(${contacts.email})`),
    );
    for (const l of lignes) {
      const liste = resultat.get(l.email) ?? [];
      liste.push({
        mandat: instance.nom,
        dernierLe: l.dernier ? new Date(l.dernier) : null,
        canal: l.canal,
        nb: l.nb,
      });
      resultat.set(l.email, liste);
    }
  }
  return resultat;
}

export type Alerte = {
  code: 'opposition' | 'exclusion' | 'email_invalide' | 'recontact' | 'deja_en_crm';
  libelle: string;
  // A blocking alert says « do not contact »; the others inform.
  bloquante: boolean;
};

const jour = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

export function alertesDe(
  f: Pick<
    FicheBase,
    | 'opposition'
    | 'exclusion'
    | 'emailInvalide'
    | 'dernierContactLe'
    | 'mandatContacteur'
    | 'crmMandat'
  >,
  maintenant = new Date(),
): Alerte[] {
  const alertes: Alerte[] = [];
  if (f.opposition)
    alertes.push({
      code: 'opposition',
      libelle: 'Opposition : ne plus contacter',
      bloquante: true,
    });
  if (f.exclusion)
    alertes.push({ code: 'exclusion', libelle: `Exclu (${f.exclusion})`, bloquante: true });
  if (f.emailInvalide)
    alertes.push({ code: 'email_invalide', libelle: 'Adresse email en erreur', bloquante: false });
  if (f.dernierContactLe) {
    const limite = new Date(f.dernierContactLe);
    limite.setMonth(limite.getMonth() + MOIS_RECONTACT);
    if (limite > maintenant)
      alertes.push({
        code: 'recontact',
        libelle: `Contacté le ${jour(f.dernierContactLe)}${f.mandatContacteur ? ` (${f.mandatContacteur})` : ''} : recontact avant ${MOIS_RECONTACT} mois déconseillé`,
        bloquante: false,
      });
  }
  if (f.crmMandat)
    alertes.push({
      code: 'deja_en_crm',
      libelle: `Déjà dans le CRM de ${f.crmMandat}`,
      bloquante: false,
    });
  return alertes;
}

// Alerts about a line of a file, before it joins the base: known by the CRM of a mandate.
export function alertesCrm(entrees: ContactCrm[] | undefined, maintenant = new Date()): string[] {
  return (entrees ?? []).map((e) => {
    if (!e.dernierLe) return `Déjà dans le CRM de ${e.mandat}`;
    const limite = new Date(e.dernierLe);
    limite.setMonth(limite.getMonth() + MOIS_RECONTACT);
    return `Contacté par ${e.mandat} le ${jour(e.dernierLe)}${limite > maintenant ? ` : recontact avant ${MOIS_RECONTACT} mois déconseillé` : ''}`;
  });
}

// Reads the CRM history of every record of the base and brings it up to date.
export async function actualiserHistorique(
  db: Database,
  instanceId: string,
): Promise<{ verifiees: number; trouvees: number }> {
  let apres = '00000000-0000-0000-0000-000000000000';
  let verifiees = 0;
  let trouvees = 0;
  for (;;) {
    const lot = await withInstance(db, instanceId, (tx) =>
      tx
        .select({ id: baseVivante.id, email: baseVivante.email })
        .from(baseVivante)
        .where(
          and(
            eq(baseVivante.instanceId, instanceId),
            gt(baseVivante.id, apres),
            sql`${baseVivante.email} is not null`,
          ),
        )
        .orderBy(asc(baseVivante.id))
        .limit(LOT),
    );
    if (lot.length === 0) break;
    apres = lot[lot.length - 1]?.id ?? apres;
    verifiees += lot.length;
    const connus = await historiqueCrm(
      db,
      lot.map((f) => (f.email ?? '').toLowerCase()),
    );
    await withInstance(db, instanceId, async (tx) => {
      for (const f of lot) {
        const entrees = connus.get((f.email ?? '').toLowerCase());
        if (!entrees) continue;
        trouvees++;
        const dernier = entrees
          .filter((e) => e.dernierLe)
          .sort((a, b) => (b.dernierLe?.getTime() ?? 0) - (a.dernierLe?.getTime() ?? 0))[0];
        await majHistorique(tx, instanceId, f.id, {
          dernierContactLe: dernier?.dernierLe ?? null,
          dernierContactCanal: dernier?.canal ?? null,
          mandatContacteur: dernier?.mandat ?? null,
          nbContacts: entrees.reduce((n, e) => n + e.nb, 0),
        });
      }
    });
  }
  return { verifiees, trouvees };
}
