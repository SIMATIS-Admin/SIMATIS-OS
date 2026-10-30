import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNotNull, notInArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { CHAMPS_QUALIFICATION, CRITERES_QUALIFICATION } from 'os-agents-relay';
import { pipelineSource } from '../crm/pipeline.js';
import {
  activites,
  affaireContacts,
  affaireEntreprises,
  contactEmails,
  contactEntreprises,
  contacts,
  entreprises,
  opportunites,
  rdvAffaires,
  rdvContacts,
  rdvEntreprises,
  rendezVous,
  taches,
} from '../crm/schema.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import type { ObjetCrm, Voit } from './schema.js';

// The CRM records of an instance in the fields of the profile crm/1 (kit, crm.js): what is read
// to send to a partner, and what a received change writes back. Links are local ids here; the
// sync turns them into references.

export type LiensLocaux = Record<string, string | string[] | null>;
export type FicheLocale = {
  id: string;
  source: string;
  modifieLe: Date;
  // Name or title, for the Inbox.
  libelle: string;
  champs: Record<string, unknown>;
  liens: LiensLocaux;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const estIso = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const entier = (v: number | null, min = -Infinity, max = Infinity) =>
  v !== null && Number.isSafeInteger(v) && v >= min && v <= max ? v : null;

// Integer marks only: a hand-made value elsewhere would make the kit refuse the whole record.
function qualificationPropre(q: Record<string, unknown> | null) {
  if (!q) return null;
  const propre = Object.fromEntries(
    CRITERES_QUALIFICATION.flatMap((c) => (Number.isInteger(q[c]) ? [[c, q[c]]] : [])),
  );
  return Object.keys(propre).length ? propre : null;
}

const datesEtapes = (d: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(d).flatMap(([etape, quand]) =>
      estIso(quand) ? [[etape, new Date(quand).toISOString()]] : [],
    ),
  );

// The profile knows four activity types; a compte rendu of a meeting is a meeting.
const typeActivite = (t: string) =>
  ['note', 'appel', 'email', 'reunion'].includes(t)
    ? t
    : t === 'compte_rendu' || t === 'rdv'
      ? 'reunion'
      : 'note';

// Excluded settings name objects and fields of the profile; emails go with the email.
function sansExclus(objet: ObjetCrm, champs: Record<string, unknown>, voit: Voit) {
  for (const cle of voit.champsExclus) {
    const [o, champ] = cle.split('.');
    if (o !== objet || !champ) continue;
    delete champs[champ];
    if (champ === 'email') delete champs.emails;
  }
  if (objet === 'affaire' && !voit.qualification)
    for (const c of CHAMPS_QUALIFICATION) delete champs[c];
  return champs;
}

// Links of the owners read, main one first (principal, then oldest).
async function liensDe(
  tx: Tx,
  table: PgTable,
  cols: {
    instance: AnyPgColumn;
    owner: AnyPgColumn;
    cible: AnyPgColumn;
    principal?: AnyPgColumn;
    createdAt: AnyPgColumn;
  },
  ids: string[] | null,
): Promise<Map<string, string[]>> {
  if (ids?.length === 0) return new Map();
  const lignes = (await tx
    .select({ owner: cols.owner, cible: cols.cible })
    .from(table)
    .where(and(eq(cols.instance, currentInstance), ids ? inArray(cols.owner, ids) : undefined))
    .orderBy(...(cols.principal ? [desc(cols.principal)] : []), asc(cols.createdAt))) as {
    owner: string;
    cible: string;
  }[];
  const parOwner = new Map<string, string[]>();
  for (const l of lignes) parOwner.set(l.owner, [...(parOwner.get(l.owner) ?? []), l.cible]);
  return parOwner;
}

// The records of one object, all of them or those changed since a date. Only meetings sorted as
// commercial ones (statut rdv) with a start are shared.
export async function lireFiches(
  tx: Tx,
  objet: ObjetCrm,
  voit: Voit,
  filtre: { depuis?: Date | null; ids?: string[] } = {},
): Promise<FicheLocale[]> {
  const ou = (t: { instanceId: AnyPgColumn; updatedAt: AnyPgColumn; id: AnyPgColumn }) =>
    and(
      eq(t.instanceId, currentInstance),
      filtre.depuis ? gt(t.updatedAt, filtre.depuis) : undefined,
      filtre.ids ? inArray(t.id, filtre.ids.length ? filtre.ids : [randomUUID()]) : undefined,
    );
  const fiches = await lireBrut(tx, objet, ou);
  for (const f of fiches) sansExclus(objet, f.champs, voit);
  return fiches;
}

async function lireBrut(
  tx: Tx,
  objet: ObjetCrm,
  ou: (t: { instanceId: AnyPgColumn; updatedAt: AnyPgColumn; id: AnyPgColumn }) => SQL | undefined,
): Promise<FicheLocale[]> {
  switch (objet) {
    case 'entreprise':
      return (await tx.select().from(entreprises).where(ou(entreprises))).map((r) => ({
        id: r.id,
        source: r.source,
        modifieLe: r.updatedAt,
        libelle: r.nom,
        champs: {
          nom: r.nom,
          secteur: r.secteur,
          ville: r.ville,
          taille: entier(r.taille),
          domaine: r.domaine,
        },
        liens: {},
      }));
    case 'contact': {
      const rows = await tx.select().from(contacts).where(ou(contacts));
      const ids = rows.map((r) => r.id);
      const autres = new Map<string, string[]>();
      if (ids.length) {
        const emails = await tx
          .select({ contactId: contactEmails.contactId, email: contactEmails.email })
          .from(contactEmails)
          .where(
            and(
              eq(contactEmails.instanceId, currentInstance),
              eq(contactEmails.principal, false),
              inArray(contactEmails.contactId, ids),
            ),
          )
          .orderBy(asc(contactEmails.email));
        for (const e of emails)
          autres.set(e.contactId, [...(autres.get(e.contactId) ?? []), e.email]);
      }
      const liens = await liensDe(
        tx,
        contactEntreprises,
        {
          instance: contactEntreprises.instanceId,
          owner: contactEntreprises.contactId,
          cible: contactEntreprises.entrepriseId,
          principal: contactEntreprises.principal,
          createdAt: contactEntreprises.createdAt,
        },
        ids,
      );
      return rows.map((r) => ({
        id: r.id,
        source: r.source,
        modifieLe: r.updatedAt,
        libelle: r.nom,
        champs: {
          nom: r.nom,
          fonction: r.fonction,
          email: r.email,
          emails: autres.get(r.id) ?? [],
          telephone: r.telephone,
          role: r.role,
        },
        liens: {
          entreprises: liens.get(r.id) ?? (r.entrepriseId ? [r.entrepriseId] : []),
        },
      }));
    }
    case 'affaire': {
      const rows = await tx.select().from(opportunites).where(ou(opportunites));
      const ids = rows.map((r) => r.id);
      const lesContacts = await liensDe(
        tx,
        affaireContacts,
        {
          instance: affaireContacts.instanceId,
          owner: affaireContacts.opportuniteId,
          cible: affaireContacts.contactId,
          principal: affaireContacts.principal,
          createdAt: affaireContacts.createdAt,
        },
        ids,
      );
      const lesEntreprises = await liensDe(
        tx,
        affaireEntreprises,
        {
          instance: affaireEntreprises.instanceId,
          owner: affaireEntreprises.opportuniteId,
          cible: affaireEntreprises.entrepriseId,
          principal: affaireEntreprises.principal,
          createdAt: affaireEntreprises.createdAt,
        },
        ids,
      );
      return rows.map((r) => ({
        id: r.id,
        source: r.source,
        modifieLe: r.updatedAt,
        libelle: r.titre,
        champs: {
          titre: r.titre,
          etape: r.etape,
          montant: entier(r.montant),
          echeance: r.echeance,
          clos: r.clos,
          motif: r.motif,
          proprietaire: r.proprietaire,
          origine: r.origine,
          prochaine_etape: r.prochaineEtape,
          mode_facturation: r.modeFacturation,
          duree_engagement_mois: entier(r.dureeEngagementMois),
          tacite_reconduction: r.taciteReconduction,
          probabilite_manuelle: entier(r.probabiliteManuelle, 0, 100),
          derniere_activite: iso(r.derniereActivite),
          etapes_dates: datesEtapes(r.etapesDates),
          qualification: qualificationPropre(r.qualification),
          potentiel: r.potentiel,
          faisabilite: r.faisabilite,
        },
        liens: {
          contacts: lesContacts.get(r.id) ?? (r.contactId ? [r.contactId] : []),
          entreprises: lesEntreprises.get(r.id) ?? (r.entrepriseId ? [r.entrepriseId] : []),
        },
      }));
    }
    case 'tache':
      return (await tx.select().from(taches).where(ou(taches))).map((r) => ({
        id: r.id,
        source: r.source,
        modifieLe: r.updatedAt,
        libelle: r.titre,
        champs: {
          titre: r.titre,
          type: r.type,
          echeance: iso(r.echeance),
          avec_heure: r.avecHeure,
          duree_minutes: entier(r.dureeMinutes),
          occupe: r.occupe,
          fait_at: iso(r.faitAt),
          notes: r.notes,
        },
        liens: { contact: r.contactId, entreprise: r.entrepriseId, affaire: r.opportuniteId },
      }));
    case 'rendez_vous': {
      const rows = await tx
        .select()
        .from(rendezVous)
        .where(and(ou(rendezVous), eq(rendezVous.statut, 'rdv'), isNotNull(rendezVous.debut)));
      const ids = rows.map((r) => r.id);
      const cols = (t: typeof rdvContacts | typeof rdvEntreprises | typeof rdvAffaires) => ({
        instance: t.instanceId,
        owner: t.rendezVousId,
        createdAt: t.createdAt,
      });
      const c = await liensDe(
        tx,
        rdvContacts,
        { ...cols(rdvContacts), cible: rdvContacts.contactId },
        ids,
      );
      const e = await liensDe(
        tx,
        rdvEntreprises,
        { ...cols(rdvEntreprises), cible: rdvEntreprises.entrepriseId },
        ids,
      );
      const a = await liensDe(
        tx,
        rdvAffaires,
        { ...cols(rdvAffaires), cible: rdvAffaires.opportuniteId },
        ids,
      );
      return rows.map((r) => ({
        id: r.id,
        source: r.source,
        modifieLe: r.updatedAt,
        libelle: r.titre,
        champs: {
          titre: r.titre,
          debut: iso(r.debut),
          fin: iso(r.fin),
          lieu: r.lieu,
          compte_rendu: r.compteRendu,
          compte_rendu_at: iso(r.compteRenduAt),
        },
        liens: {
          contacts: c.get(r.id) ?? [],
          entreprises: e.get(r.id) ?? [],
          affaires: a.get(r.id) ?? [],
        },
      }));
    }
    case 'activite':
      return (await tx.select().from(activites).where(ou(activites))).map((r) => ({
        id: r.id,
        source: r.source,
        modifieLe: r.updatedAt,
        libelle: r.titre ?? r.type,
        champs: {
          type: typeActivite(r.type),
          at: r.at.toISOString(),
          titre: r.titre,
          resume: r.resume,
        },
        liens: { contact: r.contactId, entreprise: r.entrepriseId, affaire: r.opportuniteId },
      }));
  }
}

const TABLES = {
  entreprise: entreprises,
  contact: contacts,
  affaire: opportunites,
  tache: taches,
  rendez_vous: rendezVous,
  activite: activites,
} as const;

// Ids of the records still shared: the others left (deleted, or a meeting no longer commercial).
export async function idsPartageables(
  tx: Tx,
  objet: ObjetCrm,
  ids: string[],
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const t = TABLES[objet];
  const lignes = await tx
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.instanceId, currentInstance),
        inArray(t.id, ids),
        objet === 'rendez_vous'
          ? and(eq(rendezVous.statut, 'rdv'), isNotNull(rendezVous.debut))
          : undefined,
      ),
    );
  return new Set(lignes.map((l) => l.id));
}

export async function existe(tx: Tx, objet: ObjetCrm, id: string): Promise<boolean> {
  return (await idsPartageables(tx, objet, [id])).size > 0;
}

// The stages the pipeline screen shows, in the profile's form.
export async function etapesPipeline(tx: Tx) {
  const src = await pipelineSource(tx);
  if (src.hubspot) {
    return src.hubspot.etapes.map((e) => ({
      id: e.id,
      libelle: e.label,
      ordre: e.ordre,
      clos: e.clos,
      gagne: e.gagne,
      ...(e.probabilite != null && e.probabilite >= 0 && e.probabilite <= 100
        ? { probabilite: e.probabilite }
        : {}),
    }));
  }
  return src.etapes.map((e, i) => ({
    id: e.id,
    libelle: e.label,
    ordre: i,
    clos: false,
    gagne: false,
  }));
}

// ---------------------------------------------------------------- writing

const date = (v: unknown) => (typeof v === 'string' ? new Date(v) : null);
const texte = (v: unknown) => (typeof v === 'string' ? v : null);
const nombre = (v: unknown) => (typeof v === 'number' ? v : null);

// Profile fields → columns of one object. A field left out does not change; a not-null column
// is never emptied.
function colonnes(objet: ObjetCrm, champs: Record<string, unknown>): Record<string, unknown> {
  const a = (nom: string) => Object.hasOwn(champs, nom);
  const v = (nom: string) => champs[nom];
  const out: Record<string, unknown> = {};
  const mettre = (nom: string, col: string, conv: (x: unknown) => unknown, nonNul = false) => {
    if (!a(nom)) return;
    const x = conv(v(nom));
    if (x === null && nonNul) return;
    out[col] = x;
  };
  switch (objet) {
    case 'entreprise':
      mettre('nom', 'nom', texte, true);
      mettre('secteur', 'secteur', texte);
      mettre('ville', 'ville', texte);
      mettre('taille', 'taille', nombre);
      mettre('domaine', 'domaine', texte);
      break;
    case 'contact':
      mettre('nom', 'nom', texte, true);
      mettre('fonction', 'fonction', texte);
      mettre('email', 'email', texte);
      mettre('telephone', 'telephone', texte);
      mettre('role', 'role', texte);
      break;
    case 'affaire':
      mettre('titre', 'titre', texte, true);
      mettre('etape', 'etape', texte, true);
      mettre('montant', 'montant', nombre);
      mettre('echeance', 'echeance', texte);
      mettre('clos', 'clos', texte);
      mettre('motif', 'motif', texte);
      mettre('proprietaire', 'proprietaire', texte);
      mettre('origine', 'origine', texte);
      mettre('prochaine_etape', 'prochaineEtape', texte);
      mettre('mode_facturation', 'modeFacturation', texte, true);
      mettre('duree_engagement_mois', 'dureeEngagementMois', nombre, true);
      mettre(
        'tacite_reconduction',
        'taciteReconduction',
        (x) => (typeof x === 'boolean' ? x : null),
        true,
      );
      mettre('probabilite_manuelle', 'probabiliteManuelle', nombre);
      mettre('derniere_activite', 'derniereActivite', date);
      mettre('etapes_dates', 'etapesDates', (x) => (x && typeof x === 'object' ? x : null), true);
      mettre('qualification', 'qualification', (x) => (x && typeof x === 'object' ? x : null));
      mettre('potentiel', 'potentiel', texte);
      mettre('faisabilite', 'faisabilite', texte);
      break;
    case 'tache':
      mettre('titre', 'titre', texte, true);
      mettre('type', 'type', texte, true);
      if (a('type') && typeof v('type') === 'string') {
        const t = v('type') as string;
        out.canal = t === 'appel' || t === 'email' ? t : 'tache';
      }
      mettre('echeance', 'echeance', date);
      mettre('avec_heure', 'avecHeure', (x) => (typeof x === 'boolean' ? x : null), true);
      mettre('duree_minutes', 'dureeMinutes', nombre);
      mettre('occupe', 'occupe', (x) => (typeof x === 'boolean' ? x : null), true);
      mettre('fait_at', 'faitAt', date);
      mettre('notes', 'notes', texte);
      break;
    case 'rendez_vous':
      mettre('titre', 'titre', texte, true);
      mettre('debut', 'debut', date);
      mettre('fin', 'fin', date);
      mettre('lieu', 'lieu', texte);
      mettre('compte_rendu', 'compteRendu', texte);
      mettre('compte_rendu_at', 'compteRenduAt', date);
      break;
    case 'activite':
      mettre('type', 'type', texte, true);
      mettre('at', 'at', date, true);
      mettre('titre', 'titre', texte);
      mettre('resume', 'resume', texte);
      break;
  }
  return out;
}

// Required to create a record of each object (kit MODELE_CRM obligatoires).
const OBLIGATOIRES: Record<ObjetCrm, string[]> = {
  entreprise: ['nom'],
  contact: ['nom'],
  affaire: ['titre', 'etape'],
  tache: ['titre', 'type'],
  rendez_vous: ['titre', 'debut'],
  activite: ['type', 'at'],
};

export function creable(objet: ObjetCrm, champs: Record<string, unknown>): boolean {
  return OBLIGATOIRES[objet].every((c) => champs[c] !== undefined && champs[c] !== null);
}

// A record created from a partner's change keeps where it came from: source and reference.
export async function creerFiche(
  tx: Tx,
  objet: ObjetCrm,
  champs: Record<string, unknown>,
  origine: { source: string; sourceId: string },
): Promise<string> {
  const valeurs = {
    ...colonnes(objet, champs),
    instanceId: currentInstance,
    ...(objet === 'rendez_vous'
      ? // A meeting created in the OS keeps an `os:` id, so no agenda read mistakes it for Google's.
        {
          eventId: `os:${randomUUID()}`,
          statut: 'rdv',
          source: origine.source,
          sourceId: origine.sourceId,
        }
      : origine),
  };
  const t = TABLES[objet];
  const [row] = (await tx
    .insert(t)
    .values(valeurs as never)
    .returning({ id: t.id })) as { id: string }[];
  if (!row) throw new Error(`Fiche ${objet} non créée`);
  return row.id;
}

export async function ecrireChamps(
  tx: Tx,
  objet: ObjetCrm,
  id: string,
  champs: Record<string, unknown>,
): Promise<void> {
  const set = colonnes(objet, champs);
  const t = TABLES[objet];
  if (Object.keys(set).length)
    await tx
      .update(t)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(t.instanceId, currentInstance), eq(t.id, id)));
  if (objet === 'contact' && Object.hasOwn(champs, 'emails')) {
    const voulues = [
      ...new Set(
        (Array.isArray(champs.emails) ? (champs.emails as string[]) : [])
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    // The primary address follows contacts.email (trigger): only the other ones are replaced.
    await tx
      .delete(contactEmails)
      .where(
        and(
          eq(contactEmails.instanceId, currentInstance),
          eq(contactEmails.contactId, id),
          eq(contactEmails.principal, false),
          voulues.length ? notInArray(contactEmails.email, voulues) : undefined,
        ),
      );
    for (const email of voulues)
      await tx
        .insert(contactEmails)
        .values({ instanceId: currentInstance, contactId: id, email })
        .onConflictDoNothing();
  }
}

type LienMultiple = {
  table: PgTable;
  owner: AnyPgColumn;
  cible: AnyPgColumn;
  instance: AnyPgColumn;
  ownerKey: string;
  cibleKey: string;
  principal?: AnyPgColumn;
  // Single-link column of the owner holding the main link, read by the rest of the OS.
  miroir?: { table: typeof contacts | typeof opportunites; colonne: 'entrepriseId' | 'contactId' };
};

const LIENS_MULTIPLES: Partial<Record<ObjetCrm, Record<string, LienMultiple>>> = {
  contact: {
    entreprises: {
      table: contactEntreprises,
      owner: contactEntreprises.contactId,
      cible: contactEntreprises.entrepriseId,
      instance: contactEntreprises.instanceId,
      ownerKey: 'contactId',
      cibleKey: 'entrepriseId',
      principal: contactEntreprises.principal,
      miroir: { table: contacts, colonne: 'entrepriseId' },
    },
  },
  affaire: {
    contacts: {
      table: affaireContacts,
      owner: affaireContacts.opportuniteId,
      cible: affaireContacts.contactId,
      instance: affaireContacts.instanceId,
      ownerKey: 'opportuniteId',
      cibleKey: 'contactId',
      principal: affaireContacts.principal,
      miroir: { table: opportunites, colonne: 'contactId' },
    },
    entreprises: {
      table: affaireEntreprises,
      owner: affaireEntreprises.opportuniteId,
      cible: affaireEntreprises.entrepriseId,
      instance: affaireEntreprises.instanceId,
      ownerKey: 'opportuniteId',
      cibleKey: 'entrepriseId',
      principal: affaireEntreprises.principal,
      miroir: { table: opportunites, colonne: 'entrepriseId' },
    },
  },
  rendez_vous: {
    contacts: {
      table: rdvContacts,
      owner: rdvContacts.rendezVousId,
      cible: rdvContacts.contactId,
      instance: rdvContacts.instanceId,
      ownerKey: 'rendezVousId',
      cibleKey: 'contactId',
    },
    entreprises: {
      table: rdvEntreprises,
      owner: rdvEntreprises.rendezVousId,
      cible: rdvEntreprises.entrepriseId,
      instance: rdvEntreprises.instanceId,
      ownerKey: 'rendezVousId',
      cibleKey: 'entrepriseId',
    },
    affaires: {
      table: rdvAffaires,
      owner: rdvAffaires.rendezVousId,
      cible: rdvAffaires.opportuniteId,
      instance: rdvAffaires.instanceId,
      ownerKey: 'rendezVousId',
      cibleKey: 'opportuniteId',
    },
  },
};

const COLONNES_LIEN: Record<string, string> = {
  contact: 'contactId',
  entreprise: 'entrepriseId',
  affaire: 'opportuniteId',
};

// The object a link points to (kit MODELE_CRM liens).
export const CIBLE_LIEN: Record<string, ObjetCrm> = {
  entreprises: 'entreprise',
  contacts: 'contact',
  affaires: 'affaire',
  contact: 'contact',
  entreprise: 'entreprise',
  affaire: 'affaire',
};

// A received link replaces the whole list (main one first). Targets are local ids already.
export async function ecrireLiens(
  tx: Tx,
  objet: ObjetCrm,
  id: string,
  liens: LiensLocaux,
): Promise<void> {
  for (const [nom, valeur] of Object.entries(liens)) {
    const multiple = LIENS_MULTIPLES[objet]?.[nom];
    if (multiple) {
      const cibles = [...new Set(Array.isArray(valeur) ? valeur : valeur ? [valeur] : [])];
      const m = multiple;
      await tx
        .delete(m.table)
        .where(
          and(
            eq(m.instance, currentInstance),
            eq(m.owner, id),
            cibles.length ? notInArray(m.cible, cibles) : undefined,
          ),
        );
      for (const cible of cibles)
        await tx
          .insert(m.table)
          .values({ instanceId: currentInstance, [m.ownerKey]: id, [m.cibleKey]: cible } as never)
          .onConflictDoNothing();
      if (m.principal) {
        await tx
          .update(m.table)
          .set({ principal: sql`${m.cible} = ${cibles[0] ?? null}` })
          .where(and(eq(m.instance, currentInstance), eq(m.owner, id)));
      }
      if (m.miroir) {
        const t = m.miroir.table;
        await tx
          .update(t)
          .set({ [m.miroir.colonne]: cibles[0] ?? null, updatedAt: new Date() })
          .where(and(eq(t.instanceId, currentInstance), eq(t.id, id)));
      }
      continue;
    }
    const colonne = COLONNES_LIEN[nom];
    if ((objet === 'tache' || objet === 'activite') && colonne) {
      const t = TABLES[objet];
      await tx
        .update(t)
        .set({
          [colonne]: typeof valeur === 'string' ? valeur : null,
          updatedAt: new Date(),
        })
        .where(and(eq(t.instanceId, currentInstance), eq(t.id, id)));
    }
  }
}
