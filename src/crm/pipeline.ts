import { and, asc, eq, ilike, isNotNull, isNull, min, or, sql } from 'drizzle-orm';
import { zoned } from '../connecteurs/google/creneaux.js';
import { parseReglages } from '../connecteurs/hubspot/reglages.js';
import { parseReglages as parseReglagesCrmOs } from '../connecteurs/crm-os/reglages.js';
import { connexions } from '../connexions/schema.js';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { jourDe } from '../pilotage/realisees.js';
import { contacts, entreprises, opportunites, taches } from './schema.js';
import {
  classementAffaire,
  diagnosticDeLAffaire,
  touchesRadar,
  type Classement,
} from './echanges.js';
import { assurerLiensPrincipaux } from './liens.js';
import { copieEnLectureSeule, MESSAGE_LECTURE_SEULE } from './source.js';
import { createInCrm, CrmIndisponible, likePattern } from './service.js';
import { baseVivante } from '../base-vivante/schema.js';

// Native pipeline (instances without CRM, demo data): the mockup's stages (data.js ETAPES).
export const ETAPES_NATIVES = [
  { id: 'detection', label: 'Détection' },
  { id: 'prospection', label: 'Prospection' },
  { id: 'qualification', label: 'Qualification' },
  { id: 'proposition', label: 'Proposition' },
  { id: 'negociation', label: 'Négociation' },
];

// Furthest stage reached: a won deal reached them all, a lost deal counts up to where it stopped.
// Rate k = share of the deals that reached stage k and also reached stage k + 1 (mockup rule).
export function conversionRates(
  opps: { etape: string; clos: 'gagne' | 'perdu' | null }[],
  etapes: string[],
): (number | null)[] {
  const rang = (o: (typeof opps)[number]) =>
    o.clos === 'gagne' ? etapes.length : etapes.indexOf(o.etape);
  const atteint = (k: number) => opps.filter((o) => rang(o) >= k).length;
  return etapes.map((_e, k) => {
    const den = atteint(k);
    return den ? Math.round((atteint(k + 1) / den) * 100) : null;
  });
}

type Source = {
  source: 'natif' | 'hubspot' | 'crm-os';
  etapes: { id: string; label: string; probabilite?: number | null }[];
  // HubSpot stages, closed ones included (to close or reopen a deal there).
  hubspot: ReturnType<typeof parseReglages> | null;
  ecrit: boolean;
  derniereSynchro: Date | null;
};

export async function pipelineSource(tx: Tx): Promise<Source> {
  const [crm] = await tx
    .select()
    .from(connexions)
    .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
  // The compatible CRM is mirrored read-only: its stages, no write.
  if (crm?.fournisseur === 'crm-os') {
    const reglages = parseReglagesCrmOs(crm.reglages);
    return {
      source: 'crm-os',
      etapes: reglages.etapes
        .filter((e) => !e.clos)
        .map((e) => ({ id: e.id, label: e.label, probabilite: e.probabilite ?? null })),
      hubspot: null,
      ecrit: false,
      derniereSynchro: crm.derniereSynchro,
    };
  }
  if (crm?.fournisseur !== 'hubspot') {
    return {
      source: 'natif',
      etapes: ETAPES_NATIVES,
      hubspot: null,
      ecrit: true,
      derniereSynchro: null,
    };
  }
  const reglages = parseReglages(crm.reglages);
  return {
    source: 'hubspot',
    etapes: reglages.etapes
      .filter((e) => !e.clos)
      .map((e) => ({ id: e.id, label: e.label, probabilite: e.probabilite ?? null })),
    hubspot: reglages,
    ecrit: reglages.sens === 'deux_sens',
    derniereSynchro: crm.derniereSynchro,
  };
}

export const INACTIVITE_DEFAUT = 14;
const JOUR_MS = 86_400_000;

// Vrai pour un rendez-vous commercial lié à l'affaire de la ligne en cours (« opportunites »), à son
// contact ou à son entreprise. Un créneau écarté n'en est pas un.
const rdvDeLAffaire = sql`r.instance_id = ${currentInstance} and r.statut = 'rdv' and (
  exists (select 1 from rdv_affaires x
    where x.rendez_vous_id = r.id and x.opportunite_id = "opportunites"."id")
  or (not exists (select 1 from rdv_affaires x where x.rendez_vous_id = r.id) and (
  exists (select 1 from rdv_contacts x
    where x.rendez_vous_id = r.id and x.contact_id = "opportunites"."contact_id")
  or exists (select 1 from rdv_entreprises x
    where x.rendez_vous_id = r.id and x.entreprise_id = "opportunites"."entreprise_id")))
)`;

export async function getPipeline(db: Executor, instance: Instance, maintenant = new Date()) {
  const aujourdhui = zoned(jourDe(maintenant, 'Europe/Paris'), '00:00', 'Europe/Paris');
  return withInstance(db, instance.id, async (tx) => {
    const src = await pipelineSource(tx);
    const opps = await tx
      .select({
        id: opportunites.id,
        titre: opportunites.titre,
        etape: opportunites.etape,
        clos: opportunites.clos,
        motif: opportunites.motif,
        montant: opportunites.montant,
        modeFacturation: opportunites.modeFacturation,
        dureeEngagementMois: opportunites.dureeEngagementMois,
        taciteReconduction: opportunites.taciteReconduction,
        probabiliteManuelle: opportunites.probabiliteManuelle,
        echeance: opportunites.echeance,
        qualification: opportunites.qualification,
        potentiel: opportunites.potentiel,
        faisabilite: opportunites.faisabilite,
        prochaineEtape: opportunites.prochaineEtape,
        derniereActivite: opportunites.derniereActivite,
        creeLe: opportunites.createdAt,
        entreprise: entreprises.nom,
        contact: contacts.nom,
        origineCommerciale: opportunites.origine,
        radarEtapeManuelle: opportunites.radarEtapeManuelle,
        // Rendez-vous commerciaux liés à l'affaire, à son contact ou à son entreprise.
        prochainRdv: sql<Date | null>`(select min(r.debut) from rendez_vous r
          where ${rdvDeLAffaire} and r.debut >= ${maintenant})`,
        aUnRdv: sql<boolean>`exists (select 1 from rendez_vous r where ${rdvDeLAffaire})`,
        classement: classementAffaire,
        tentatives: touchesRadar,
        canalRadar: sql<
          string | null
        >`coalesce((select case when lower(t.titre) like '%linkedin%' then 'LinkedIn'
          when t.canal = 'appel' then 'Téléphone' when t.canal = 'email' then 'E-mail' end
          from taches t where t.instance_id = ${currentInstance} and t.fait_at is not null
          and (t.opportunite_id = "opportunites"."id" or (t.opportunite_id is null and t.contact_id = "opportunites"."contact_id"))
          order by t.fait_at desc, t.id limit 1), (select 'E-mail' from contact_echanges_mail m
          where m.instance_id = ${currentInstance} and m.envoyes > 0 and
          (m.contact_id = "opportunites"."contact_id" or exists (select 1 from affaire_contacts ac
          where ac.opportunite_id = "opportunites"."id" and ac.contact_id = m.contact_id)) limit 1))`,
        diagnostic: diagnosticDeLAffaire,
      })
      .from(opportunites)
      .leftJoin(
        entreprises,
        and(
          eq(entreprises.id, opportunites.entrepriseId),
          eq(entreprises.instanceId, currentInstance),
        ),
      )
      .leftJoin(
        contacts,
        and(eq(contacts.id, opportunites.contactId), eq(contacts.instanceId, currentInstance)),
      )
      .where(eq(opportunites.instanceId, currentInstance))
      .orderBy(asc(opportunites.echeance));
    // Pipedrive signals: the earliest open activity of each deal, and days without activity.
    const prochaines = new Map(
      (
        await tx
          .select({ opp: taches.opportuniteId, echeance: min(taches.echeance) })
          .from(taches)
          .where(
            and(
              eq(taches.instanceId, currentInstance),
              isNull(taches.faitAt),
              isNotNull(taches.opportuniteId),
            ),
          )
          .groupBy(taches.opportuniteId)
      ).map((r) => [r.opp, r.echeance]),
    );
    // Un diagnostic réalisé place l'affaire au moins en Qualification, dans l'OS seulement : une
    // étape plus basse du CRM est affichée en Qualification, sans rien y écrire.
    const rang = new Map(src.etapes.map((e, k) => [e.id, k]));
    const qualification = src.etapes.find((e) =>
      `${e.id} ${e.label}`
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .includes('qualif'),
    )?.id;
    const etapeVue = (etape: string, diagnostic: boolean) =>
      diagnostic &&
      qualification !== undefined &&
      (rang.get(etape) ?? Infinity) < (rang.get(qualification) ?? -1)
        ? qualification
        : etape;
    const contactsARattacher = await tx
      .select({
        id: baseVivante.id,
        entreprise: baseVivante.entreprise,
        nom: sql<string>`trim(concat_ws(' ', ${baseVivante.prenom}, ${baseVivante.nom}))`,
        linkedin: baseVivante.linkedin,
        provenance: baseVivante.provenance,
        statut: baseVivante.statutProspection,
      })
      .from(baseVivante)
      .where(
        and(
          eq(baseVivante.instanceId, currentInstance),
          isNull(baseVivante.crmContactId),
          eq(baseVivante.opposition, false),
          isNull(baseVivante.exclusion),
          eq(baseVivante.statutProspection, 'a_repondu'),
          sql`not exists (select 1 from contacts c where c.instance_id = ${currentInstance}
        and nullif(trim(c.email), '') is not null and lower(trim(c.email)) = lower(trim(${baseVivante.email})))`,
        ),
      )
      .orderBy(asc(baseVivante.entreprise), asc(baseVivante.id));
    return {
      source: src.source,
      contactsARattacher,
      ecrit: src.ecrit,
      derniereSynchro: src.derniereSynchro,
      etapes: src.etapes,
      conversions: conversionRates(
        opps,
        src.etapes.map((e) => e.id),
      ),
      inactiviteJours: instance.config.inactiviteJours ?? INACTIVITE_DEFAUT,
      opportunites: opps.map(
        ({ derniereActivite, creeLe, prochainRdv, aUnRdv, classement, diagnostic, ...o }) => {
          const prochaine = o.clos ? null : (prochaines.get(o.id) ?? null);
          const depuis = derniereActivite ?? creeLe;
          const etape = o.clos ? o.etape : etapeVue(o.etape, diagnostic || aUnRdv);
          const avantQualification =
            (rang.get(o.etape) ?? Infinity) < (rang.get(qualification ?? '') ?? 0);
          return {
            ...o,
            etape,
            // L'étape du CRM quand l'OS affiche l'affaire plus haut (diagnostic réalisé).
            etapeCrm: etape === o.etape ? null : o.etape,
            diagnostic,
            derniereActivite: derniereActivite?.toISOString() ?? null,
            // Ouverte sans rendez-vous ni diagnostic : une personne encore en prospection.
            sansRdv: !o.clos && !aUnRdv && !diagnostic,
            // Sans rendez-vous ni diagnostic, et déjà approchée : suivie dans le Radar, plus ici.
            radar:
              !o.clos && !aUnRdv && !diagnostic
                ? (classement ?? (avantQualification ? 'a_contacter' : null))
                : null,
            prochainRdv: o.clos || !prochainRdv ? null : new Date(prochainRdv).toISOString(),
            prochaine: prochaine
              ? { echeance: prochaine.toISOString(), enRetard: prochaine < aujourdhui }
              : null,
            joursInactif: o.clos
              ? null
              : Math.floor((maintenant.getTime() - depuis.getTime()) / JOUR_MS),
          };
        },
      ),
    };
  });
}

export type AffaireRadar = {
  id: string;
  titre: string;
  entreprise: string | null;
  contact: string | null;
};
export type AffairesAuRadar = Record<
  'contactes' | 'ontRepondu',
  { total: number; fiches: AffaireRadar[] }
>;

// Les affaires ouvertes sans rendez-vous que la messagerie range au Radar : écrites sans réponse
// (« Contactés »), ou qui ont répondu (« Ont répondu »). Rien n'est écrit, ni ici ni dans le CRM :
// un rendez-vous pris les rend au Pipeline.
export async function affairesAuRadar(
  db: Executor,
  instanceId: string,
  limite = 5,
): Promise<AffairesAuRadar> {
  return withInstance(db, instanceId, async (tx) => {
    const lignes = await tx
      .select({
        id: opportunites.id,
        titre: opportunites.titre,
        entreprise: entreprises.nom,
        contact: contacts.nom,
        classement: classementAffaire,
      })
      .from(opportunites)
      .leftJoin(
        entreprises,
        and(
          eq(entreprises.id, opportunites.entrepriseId),
          eq(entreprises.instanceId, currentInstance),
        ),
      )
      .leftJoin(
        contacts,
        and(eq(contacts.id, opportunites.contactId), eq(contacts.instanceId, currentInstance)),
      )
      .where(
        and(
          eq(opportunites.instanceId, currentInstance),
          isNull(opportunites.clos),
          sql`not exists (select 1 from rendez_vous r where ${rdvDeLAffaire})`,
          sql`${classementAffaire} is not null`,
        ),
      )
      .orderBy(asc(entreprises.nom), asc(opportunites.titre), asc(opportunites.id));
    const colonne = (c: Classement) => {
      const fiches = lignes
        .filter((l) => l.classement === c)
        .map((l) => ({ id: l.id, titre: l.titre, entreprise: l.entreprise, contact: l.contact }));
      return { total: fiches.length, fiches: fiches.slice(0, limite) };
    };
    return { contactes: colonne('sans_reponse'), ontRepondu: colonne('repondu') };
  });
}

export type Changement =
  { etape: string } | { clos: 'gagne' | 'perdu'; motif?: string | null } | { rouvrir: true };

export class ChangementInvalide extends Error {}

// Moves, closes or reopens a deal. Under a CRM, the change is written there first (or simulated),
// then on the copy; a read-only CRM refuses it.
export async function changeOpportunite(
  db: Executor,
  instance: Instance,
  id: string,
  change: Changement,
  deps: ConnexionDeps,
) {
  return withInstance(db, instance.id, async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunites)
      .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.id, id)));
    if (!opp) return null;
    if (copieEnLectureSeule(opp.source)) throw new CrmIndisponible(MESSAGE_LECTURE_SEULE);
    const src = await pipelineSource(tx);
    const label = (stage: string) => src.etapes.find((e) => e.id === stage)?.label ?? stage;

    let next: { etape: string; clos: 'gagne' | 'perdu' | null; motif: string | null };
    let action: string;
    if ('etape' in change) {
      if (!src.etapes.some((e) => e.id === change.etape)) {
        throw new ChangementInvalide(`Étape inconnue : ${change.etape}`);
      }
      next = { etape: change.etape, clos: null, motif: null };
      action = `${opp.clos ? 'Opportunité rouverte' : 'Étape changée'} : ${opp.titre} → ${label(change.etape)}`;
    } else if ('clos' in change) {
      // Native deals keep the stage where they stopped; HubSpot ones move to the closed stage.
      const closed = src.hubspot?.etapes.find(
        (e) => e.clos && e.gagne === (change.clos === 'gagne'),
      );
      if (src.hubspot && !closed)
        throw new ChangementInvalide('Aucune étape de clôture dans HubSpot');
      next = {
        etape: closed?.id ?? opp.etape,
        clos: change.clos,
        motif: change.clos === 'perdu' ? (change.motif ?? null) : null,
      };
      action = `Opportunité ${change.clos === 'gagne' ? 'gagnée' : 'perdue'} : ${opp.titre}${next.motif ? ` (${next.motif})` : ''}`;
    } else {
      const lastOpen = src.etapes.at(-1)?.id ?? opp.etape;
      next = {
        etape: src.etapes.some((e) => e.id === opp.etape) ? opp.etape : lastOpen,
        clos: null,
        motif: null,
      };
      action = `Opportunité rouverte : ${opp.titre}`;
    }

    let simulation = false;
    if (src.source === 'hubspot') {
      if (!src.ecrit) {
        throw new CrmIndisponible(
          'Pipeline en lecture seule : changez l’étape dans HubSpot, elle remontera à la prochaine synchronisation.',
        );
      }
      try {
        const result = await writeVia(
          tx,
          instance,
          'crm',
          { op: 'deal.stage', data: { opportuniteId: opp.id, etape: next.etape } },
          deps,
        );
        simulation = result.simulation;
      } catch (error) {
        throw new CrmIndisponible(
          `Refusé par HubSpot : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const [row] = await tx
      .update(opportunites)
      .set({
        ...next,
        // Stage entry dates feed the progress bar of the deal page.
        ...(next.etape !== opp.etape && !simulation
          ? { etapesDates: { ...opp.etapesDates, [next.etape]: new Date().toISOString() } }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(opportunites.id, opp.id))
      .returning();
    await logEvent(tx, {
      acteur: 'pilote',
      action: `${action}${simulation ? ' (simulation : HubSpot inchangé)' : ''}`,
      niveau: 'L2',
    });
    return { opportunite: row ?? opp, simulation };
  });
}

// New deal from a pipeline column (Pipedrive « + »): in HubSpot first under a CRM, else in the OS.
export async function createOpportunite(
  db: Executor,
  instance: Instance,
  input: {
    titre: string;
    etape: string;
    montant?: number | null;
    modeFacturation?: 'spot' | 'recurrent';
    dureeEngagementMois?: number;
    taciteReconduction?: boolean;
    echeance?: string | null;
    contactId?: string | null;
    entrepriseId?: string | null;
  },
  deps: ConnexionDeps,
) {
  return withInstance(db, instance.id, async (tx) => {
    const src = await pipelineSource(tx);
    if (!src.etapes.some((e) => e.id === input.etape))
      throw new ChangementInvalide('Étape inconnue ou close');
    for (const [table, id, nom] of [
      [contacts, input.contactId, 'Contact'],
      [entreprises, input.entrepriseId, 'Entreprise'],
    ] as const) {
      if (!id) continue;
      const [found] = await tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.instanceId, currentInstance), eq(table.id, id)));
      if (!found) throw new ChangementInvalide(`${nom} introuvable dans cette instance`);
    }
    const crm = await createInCrm(tx, instance, 'deal.create', input, deps);
    if (crm && 'simulation' in crm) return crm;
    const [row] = await tx
      .insert(opportunites)
      .values({
        instanceId: currentInstance,
        titre: input.titre.trim(),
        etape: input.etape,
        montant: input.montant ?? null,
        modeFacturation: input.modeFacturation ?? 'spot',
        dureeEngagementMois: input.dureeEngagementMois ?? 12,
        taciteReconduction: input.taciteReconduction ?? true,
        echeance: input.echeance ?? null,
        contactId: input.contactId ?? null,
        entrepriseId: input.entrepriseId ?? null,
        etapesDates: { [input.etape]: new Date().toISOString() },
        ...(crm ? { source: 'hubspot', sourceId: crm.sourceId } : {}),
      })
      .returning();
    if (!row) throw new Error('Opportunité non créée');
    await assurerLiensPrincipaux(tx, 'affaire', row.id);
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Opportunité créée : ${row.titre}`,
      niveau: 'L2',
    });
    return row;
  });
}

// Deals to link an activity to (Pipedrive activity window), open ones first.
export async function rechercherOpportunites(db: Executor, instance: Instance, q: string) {
  const motif = likePattern(q);
  return withInstance(db, instance.id, (tx) =>
    tx
      .select({
        id: opportunites.id,
        titre: opportunites.titre,
        entreprise: entreprises.nom,
        clos: opportunites.clos,
      })
      .from(opportunites)
      .leftJoin(
        entreprises,
        and(
          eq(entreprises.id, opportunites.entrepriseId),
          eq(entreprises.instanceId, currentInstance),
        ),
      )
      .where(
        and(
          eq(opportunites.instanceId, currentInstance),
          or(ilike(opportunites.titre, motif), ilike(entreprises.nom, motif)),
        ),
      )
      .orderBy(sql`${opportunites.clos} nulls first`, asc(opportunites.titre))
      .limit(10),
  );
}
