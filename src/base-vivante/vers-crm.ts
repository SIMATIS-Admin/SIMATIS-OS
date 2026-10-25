import { and, eq, ilike, isNull, sql } from 'drizzle-orm';
import { activites, contacts, entreprises } from '../crm/schema.js';
import { createContact, createEntreprise, CrmIndisponible } from '../crm/service.js';
import type { ConnexionDeps } from '../connexions/service.js';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { peutEntrerDansLeCrm } from './completude.js';
import { lierCrm } from './integration.js';
import { baseVivante, type FicheBase } from './schema.js';

export type EntreeCrm =
  | { resultat: 'cree' | 'existant'; mandat: string }
  // Real writes to the mandate's CRM are off: nothing was created anywhere.
  | { resultat: 'simulation'; mandat: string }
  | { resultat: 'refuse'; raison: string };

const refus = (raison: string): EntreeCrm => ({ resultat: 'refuse', raison });

// The only way from the base to a CRM. A record to enrich, an opposition, an exclusion or an
// address in error never goes through; a mandate under HubSpot follows its double lock (the
// creation is simulated unless real writes are on for the server and for the instance).
export function motifRefus(f: FicheBase): string | null {
  if (!peutEntrerDansLeCrm(f.zone)) return 'Fiche à enrichir : pas de moyen de contact valide.';
  if (f.opposition) return 'Opposition : ne plus contacter.';
  if (f.exclusion) return `Exclu (${f.exclusion}).`;
  if (f.crmContactId) return `Déjà dans le CRM de ${f.crmMandat ?? 'un mandat'}.`;
  return null;
}

function mandatDe(instances: Instance[], f: FicheBase): Instance | null {
  if (!f.mandatContacteur) return null;
  return instances.find((i) => i.type === 'mandat' && i.nom === f.mandatContacteur) ?? null;
}

export async function entrerDansCrm(
  db: Executor,
  deps: ConnexionDeps,
  baseId: string,
  ficheId: string,
  instances?: Instance[],
): Promise<EntreeCrm> {
  const fiche = await withInstance(db, baseId, async (tx) => {
    const [f] = await tx
      .select()
      .from(baseVivante)
      .where(and(eq(baseVivante.id, ficheId), eq(baseVivante.instanceId, baseId)));
    return f ?? null;
  });
  if (!fiche) return refus('Fiche introuvable.');
  const motif = motifRefus(fiche);
  if (motif) return refus(motif);
  const mandat = mandatDe(instances ?? (await listInstances(db)), fiche);
  if (!mandat) return refus('Le mandat qui a contacté cette fiche est introuvable.');

  // An address known to bounce never enters a CRM.
  const email = fiche.emailInvalide ? null : fiche.email;
  const existant = email
    ? await withInstance(db, mandat.id, async (tx) => {
        const [c] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.instanceId, mandat.id), sql`lower(${contacts.email}) = ${email}`));
        return c ?? null;
      })
    : null;

  let contactId = existant?.id ?? null;
  let entrepriseId: string | null = null;
  if (!contactId) {
    try {
      entrepriseId = await withInstance(db, mandat.id, async (tx) => {
        const [e] = await tx
          .select({ id: entreprises.id })
          .from(entreprises)
          .where(
            and(
              eq(entreprises.instanceId, mandat.id),
              fiche.domaine
                ? eq(entreprises.domaine, fiche.domaine)
                : ilike(
                    entreprises.nom,
                    fiche.entreprise.replace(/[\\%_]/g, (c) => `\\${c}`),
                  ),
            ),
          );
        return e?.id ?? null;
      });
      if (!entrepriseId) {
        const e = await createEntreprise(
          db,
          mandat,
          { nom: fiche.entreprise, domaine: fiche.domaine },
          deps,
        );
        if ('simulation' in e) return { resultat: 'simulation', mandat: mandat.nom };
        entrepriseId = e.id;
      }
      const c = await createContact(
        db,
        mandat,
        {
          nom: [fiche.prenom, fiche.nom].filter(Boolean).join(' '),
          fonction: fiche.fonction,
          email,
          telephone: fiche.telephone,
          entrepriseId,
        },
        deps,
      );
      if ('simulation' in c) return { resultat: 'simulation', mandat: mandat.nom };
      contactId = c.id;
    } catch (error) {
      // A CRM that refuses (read-only, no connector…) leaves the record where it was.
      if (error instanceof CrmIndisponible) return refus(error.message);
      throw error;
    }
  }

  await withInstance(db, mandat.id, async (tx) => {
    // The reply is dated by the mailbox; its content stays out of the CRM.
    await tx.insert(activites).values({
      instanceId: mandat.id,
      type: 'email',
      contactId,
      entrepriseId,
      titre: 'Réponse à la prospection',
      at: fiche.dernierContactLe ?? new Date(),
    });
  });
  await withInstance(db, baseId, (tx) =>
    lierCrm(tx, baseId, fiche.id, { crmMandat: mandat.nom, crmContactId: contactId }),
  );
  return { resultat: existant ? 'existant' : 'cree', mandat: mandat.nom };
}

export type RapportEntrees = {
  cree: number;
  existant: number;
  simulation: number;
  refuse: number;
};

// Everyone who answered goes into the CRM of the mandate that wrote to them.
export async function entrerRepondants(
  db: Executor,
  deps: ConnexionDeps,
  baseId: string,
): Promise<RapportEntrees> {
  const ids = await withInstance(db, baseId, (tx) =>
    tx
      .select({ id: baseVivante.id })
      .from(baseVivante)
      .where(
        and(
          eq(baseVivante.instanceId, baseId),
          eq(baseVivante.statutProspection, 'a_repondu'),
          isNull(baseVivante.crmContactId),
        ),
      ),
  );
  const rapport: RapportEntrees = { cree: 0, existant: 0, simulation: 0, refuse: 0 };
  const instances = await listInstances(db);
  for (const { id } of ids)
    rapport[(await entrerDansCrm(db, deps, baseId, id, instances)).resultat]++;
  return rapport;
}
