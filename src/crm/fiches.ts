import { and, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { parseReglages } from '../connecteurs/hubspot/reglages.js';
import { connexions } from '../connexions/schema.js';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { pipelineSource } from './pipeline.js';
import { activites, contacts, entreprises, opportunites, taches } from './schema.js';
import { CrmIndisponible } from './service.js';
import { listTachesOuvertes, type TacheVue } from './taches.js';

// Pipedrive-like detail page of a deal, a contact or a company: summary, links, next activities
// and a history merged from notes, calls, emails, meetings, done activities and stage changes.
export type Kind = 'affaire' | 'contact' | 'entreprise';
export const KINDS: Kind[] = ['affaire', 'contact', 'entreprise'];

export type Evenement = {
  id: string;
  type: 'note' | 'appel' | 'email' | 'reunion' | 'activite' | 'etape';
  titre: string | null;
  texte: string | null;
  at: string;
  origine: 'hubspot' | 'os';
};
type Lien = { id: string; nom: string };
export type Fiche = {
  kind: Kind;
  fiche: Record<string, unknown> & { id: string; origine: 'hubspot' | 'os' };
  liens: {
    entreprise?: Lien | null;
    contact?: Lien | null;
    affaires?: {
      id: string;
      titre: string;
      etape: string;
      clos: string | null;
      montant: number | null;
    }[];
    contacts?: Lien[];
  };
  aVenir: TacheVue[];
  historique: Evenement[];
  etapes?: { id: string; label: string; probabilite: number | null; jours: number | null }[];
  ecrit: boolean;
};
export type SimulationFiche = { simulation: true; message: string };
export class FicheInvalide extends Error {}

const SIMULATION: SimulationFiche = {
  simulation: true,
  message: "Simulation : rien n'a été écrit dans HubSpot (écritures réelles désactivées).",
};
const JOUR = 86_400_000;
const origine = (source: string): 'hubspot' | 'os' => (source === 'hubspot' ? 'hubspot' : 'os');

async function crm(tx: Tx) {
  const [c] = await tx
    .select({ fournisseur: connexions.fournisseur, reglages: connexions.reglages })
    .from(connexions)
    .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
  return c?.fournisseur === 'hubspot' ? parseReglages(c.reglages) : null;
}

const table = { affaire: opportunites, contact: contacts, entreprise: entreprises } as const;

async function ligne(tx: Tx, kind: Kind, id: string) {
  const t = table[kind];
  const [row] = await tx
    .select()
    .from(t)
    .where(and(eq(t.instanceId, currentInstance), eq(t.id, id)));
  return row ?? null;
}

async function lien(tx: Tx, kind: 'contact' | 'entreprise', id: string | null) {
  if (!id) return null;
  const row = await ligne(tx, kind, id);
  return row ? { id: row.id, nom: (row as { nom: string }).nom } : null;
}

// Which history rows and tasks belong to the record (a company gathers its contacts and deals).
async function portee(tx: Tx, kind: Kind, id: string) {
  if (kind === 'affaire') return { contacts: [] as string[], opps: [id], entreprise: null };
  if (kind === 'contact') {
    const opps = await tx
      .select({ id: opportunites.id })
      .from(opportunites)
      .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.contactId, id)));
    return { contacts: [id], opps: opps.map((o) => o.id), entreprise: null };
  }
  const cs = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.entrepriseId, id)));
  const os = await tx
    .select({ id: opportunites.id })
    .from(opportunites)
    .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.entrepriseId, id)));
  return { contacts: cs.map((c) => c.id), opps: os.map((o) => o.id), entreprise: id };
}

function lie(
  p: { contacts: string[]; opps: string[]; entreprise: string | null },
  cols: { contactId: AnyPgColumn; opportuniteId: AnyPgColumn },
  entrepriseCol?: AnyPgColumn,
): SQL {
  const conds: SQL[] = [];
  if (p.contacts.length) conds.push(inArray(cols.contactId, p.contacts));
  if (p.opps.length) conds.push(inArray(cols.opportuniteId, p.opps));
  if (p.entreprise && entrepriseCol) conds.push(eq(entrepriseCol, p.entreprise));
  // No contact, deal or company in scope: nothing matches.
  return conds.length ? (or(...conds) as SQL) : sql`false`;
}

async function lire(tx: Tx, kind: Kind, id: string, maintenant: Date): Promise<Fiche | null> {
  const row = await ligne(tx, kind, id);
  if (!row) return null;
  const reglages = await crm(tx);
  const p = await portee(tx, kind, id);

  const notes = await tx
    .select()
    .from(activites)
    .where(
      and(
        eq(activites.instanceId, currentInstance),
        p.contacts.length || p.opps.length || p.entreprise
          ? lie(p, activites, activites.entrepriseId)
          : undefined,
      ),
    )
    .orderBy(desc(activites.at));
  const faites = await tx
    .select({ id: taches.id, titre: taches.titre, faitAt: taches.faitAt, source: taches.source })
    .from(taches)
    .where(and(eq(taches.instanceId, currentInstance), isNotNull(taches.faitAt), lie(p, taches)));
  const historique: Evenement[] = [
    ...notes.map((n) => ({
      id: n.id,
      type: n.type as Evenement['type'],
      titre: n.titre,
      texte: n.resume,
      at: n.at.toISOString(),
      origine: origine(n.source),
    })),
    ...faites.map((t) => ({
      id: t.id,
      type: 'activite' as const,
      titre: t.titre,
      texte: null,
      at: t.faitAt?.toISOString() ?? '',
      origine: origine(t.source),
    })),
  ];

  const fiche = { ...row, origine: origine(row.source) } as Fiche['fiche'];
  const liens: Fiche['liens'] = {};
  let etapes: Fiche['etapes'];
  if (kind === 'affaire') {
    const o = row as typeof opportunites.$inferSelect;
    liens.entreprise = await lien(tx, 'entreprise', o.entrepriseId);
    liens.contact = await lien(tx, 'contact', o.contactId);
    const src = await pipelineSource(tx);
    const toutes = src.hubspot?.etapes ?? src.etapes.map((e) => ({ ...e, probabilite: null }));
    const dates = o.etapesDates;
    const franchies = toutes.filter((e) => dates[e.id]).map((e) => e.id);
    etapes = src.etapes.map((e) => {
      const debut = dates[e.id];
      const suivante = franchies
        .map((f) => dates[f] ?? '')
        .filter((d) => debut && d > debut)
        .sort()[0];
      const fin = suivante ? Date.parse(suivante) : maintenant.getTime();
      return {
        id: e.id,
        label: e.label,
        probabilite: toutes.find((x) => x.id === e.id)?.probabilite ?? null,
        jours: debut ? Math.floor((fin - Date.parse(debut)) / JOUR) : null,
      };
    });
    for (const e of toutes) {
      const d = dates[e.id];
      if (d)
        historique.push({
          id: `etape-${e.id}`,
          type: 'etape',
          titre: e.label,
          texte: null,
          at: new Date(d).toISOString(),
          origine: origine(o.source),
        });
    }
  } else if (kind === 'contact') {
    const c = row as typeof contacts.$inferSelect;
    liens.entreprise = await lien(tx, 'entreprise', c.entrepriseId);
  } else {
    liens.contacts = (
      await tx
        .select({ id: contacts.id, nom: contacts.nom })
        .from(contacts)
        .where(inArray(contacts.id, p.contacts.length ? p.contacts : [id]))
    ).filter((c) => p.contacts.includes(c.id));
  }
  if (kind !== 'affaire') {
    liens.affaires = p.opps.length
      ? await tx
          .select({
            id: opportunites.id,
            titre: opportunites.titre,
            etape: opportunites.etape,
            clos: opportunites.clos,
            montant: opportunites.montant,
          })
          .from(opportunites)
          .where(inArray(opportunites.id, p.opps))
      : [];
  }

  historique.sort((x, y) => y.at.localeCompare(x.at));
  return {
    kind,
    fiche,
    liens,
    aVenir: await listTachesOuvertes(tx, lie(p, taches)),
    historique,
    ...(etapes ? { etapes } : {}),
    ecrit: row.source !== 'hubspot' || reglages?.sens === 'deux_sens',
  };
}

export async function getFiche(
  db: Executor,
  instance: Instance,
  kind: Kind,
  id: string,
  maintenant = new Date(),
): Promise<Fiche | null> {
  return withInstance(db, instance.id, (tx) => lire(tx, kind, id, maintenant));
}

export type PatchFiche = {
  titre?: string;
  montant?: number | null;
  echeance?: string | null;
  nom?: string;
  fonction?: string | null;
  email?: string | null;
  telephone?: string | null;
  ville?: string | null;
  domaine?: string | null;
  taille?: number | null;
  secteur?: string | null;
  contactId?: string | null;
  entrepriseId?: string | null;
};

const CHAMPS: Record<Kind, (keyof PatchFiche)[]> = {
  affaire: ['titre', 'montant', 'echeance', 'contactId', 'entrepriseId'],
  contact: ['nom', 'fonction', 'email', 'telephone', 'entrepriseId'],
  entreprise: ['nom', 'ville', 'domaine', 'taille', 'secteur'],
};

async function verifierLiens(tx: Tx, patch: PatchFiche) {
  for (const [kind, id, nom] of [
    ['contact', patch.contactId, 'Contact'],
    ['entreprise', patch.entrepriseId, 'Entreprise'],
  ] as const) {
    if (id && !(await ligne(tx, kind, id)))
      throw new FicheInvalide(`${nom} introuvable dans cette instance`);
  }
}

async function ecrireHubspot(
  tx: Tx,
  instance: Instance,
  op: string,
  data: Record<string, unknown>,
  deps: ConnexionDeps,
) {
  try {
    return (await writeVia(tx, instance, 'crm', { op, data }, deps)).simulation;
  } catch (error) {
    throw new CrmIndisponible(
      `Refusé par HubSpot : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// A HubSpot record is written to HubSpot first (HubSpot is the reference); its copy changes only
// when the write really happened. An OS record changes right away.
export async function updateFiche(
  db: Executor,
  instance: Instance,
  kind: Kind,
  id: string,
  patch: PatchFiche,
  deps: ConnexionDeps,
): Promise<Fiche | SimulationFiche | null> {
  const champs = Object.fromEntries(
    Object.entries(patch).filter(
      ([k, v]) => CHAMPS[kind].includes(k as keyof PatchFiche) && v !== undefined,
    ),
  ) as PatchFiche;
  if (Object.keys(champs).length === 0) throw new FicheInvalide('Aucun champ modifiable');
  return withInstance(db, instance.id, async (tx) => {
    const row = await ligne(tx, kind, id);
    if (!row) return null;
    await verifierLiens(tx, champs);

    if (row.source === 'hubspot') {
      if ((await crm(tx))?.sens !== 'deux_sens') {
        throw new CrmIndisponible(
          'CRM en lecture seule : modifiez la fiche dans HubSpot, elle remontera à la prochaine synchronisation.',
        );
      }
      if (kind === 'entreprise' && champs.secteur !== undefined) {
        throw new FicheInvalide('Le secteur d’une entreprise HubSpot se modifie dans HubSpot.');
      }
      let simulation = false;
      if (kind === 'affaire') {
        const { contactId, entrepriseId, ...valeurs } = champs;
        if (Object.keys(valeurs).length)
          simulation = await ecrireHubspot(
            tx,
            instance,
            'deal.update',
            { opportuniteId: id, ...valeurs },
            deps,
          );
        if (contactId || entrepriseId)
          simulation =
            (await ecrireHubspot(
              tx,
              instance,
              'deal.associer',
              { opportuniteId: id, contactId, entrepriseId },
              deps,
            )) || simulation;
      } else {
        simulation = await ecrireHubspot(
          tx,
          instance,
          kind === 'contact' ? 'contact.update' : 'company.update',
          { [kind === 'contact' ? 'contactId' : 'entrepriseId']: id, ...champs },
          deps,
        );
      }
      if (simulation) return SIMULATION;
    }

    const t = table[kind];
    await tx
      .update(t)
      .set({ ...champs, updatedAt: new Date() })
      .where(and(eq(t.instanceId, currentInstance), eq(t.id, id)));
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Fiche modifiée (${Object.keys(champs).join(', ')})`,
      niveau: 'L2',
    });
    return lire(tx, kind, id, new Date());
  });
}

export async function ajouterNote(
  db: Executor,
  instance: Instance,
  kind: Kind,
  id: string,
  input: { corps: string; hubspot?: boolean },
  deps: ConnexionDeps,
): Promise<Fiche | SimulationFiche | null> {
  const corps = input.corps.trim();
  if (!corps) throw new FicheInvalide('Note vide');
  return withInstance(db, instance.id, async (tx) => {
    const row = await ligne(tx, kind, id);
    if (!row) return null;
    const liens = {
      contactId:
        kind === 'contact'
          ? id
          : kind === 'affaire'
            ? (row as { contactId: string | null }).contactId
            : null,
      entrepriseId:
        kind === 'entreprise'
          ? id
          : ((row as { entrepriseId?: string | null }).entrepriseId ?? null),
      opportuniteId: kind === 'affaire' ? id : null,
    };
    let sourceId: string | null = null;
    if (input.hubspot) {
      if (row.source !== 'hubspot')
        throw new FicheInvalide('Cette fiche n’existe pas dans HubSpot');
      if ((await crm(tx))?.sens !== 'deux_sens')
        throw new CrmIndisponible('CRM en lecture seule : ajoutez la note dans HubSpot.');
      let result;
      try {
        result = await writeVia(
          tx,
          instance,
          'crm',
          { op: 'note.create', data: { corps, ...liens } },
          deps,
        );
      } catch (error) {
        throw new CrmIndisponible(
          `Refusé par HubSpot : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (result.simulation) return SIMULATION;
      sourceId = typeof result.id === 'string' ? result.id : null;
    }
    await tx.insert(activites).values({
      instanceId: currentInstance,
      type: 'note',
      resume: corps,
      at: new Date(),
      ...liens,
      ...(sourceId ? { source: 'hubspot', sourceId } : {}),
    });
    await logEvent(tx, { acteur: 'pilote', action: 'Note ajoutée', niveau: 'L2' });
    return lire(tx, kind, id, new Date());
  });
}
