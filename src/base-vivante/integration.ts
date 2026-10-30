import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db.js';
import { evaluer, type Zone } from './completude.js';
import { clesDoublon, normaliserFiche, type Fiche } from './nettoyage.js';
import {
  baseVivante,
  type Exclusion,
  type FicheBase,
  type Resultat,
  type StatutProspection,
} from './schema.js';

// THE only way into the living base: nothing else may insert or update `base_vivante`
// (guarded by integration.test.ts). Whatever the caller — import, API, routine — a record that is
// incomplete or not in its normalised form is refused here.
export class FicheNonHomogene extends Error {}

export type FicheAIntegrer = {
  fiche: Fiche;
  provenance: string;
  mandat: string | null;
  importId: string | null;
  collecteLe: string | null;
};

export type Integree = { id: string; fusionnee: boolean; zone: Zone };

export function verifierHomogene(fiche: Fiche): Zone {
  const completude = evaluer(fiche);
  if (completude.etat !== 'pret')
    throw new FicheNonHomogene(`Fiche incomplète : ${completude.raison.toLowerCase()}`);
  if (!isDeepStrictEqual(normaliserFiche(fiche).fiche, fiche))
    throw new FicheNonHomogene('Fiche non normalisée');
  return completude.zone;
}

type Travail = {
  valeurs: typeof baseVivante.$inferInsert & { id: string };
  nouvelle: boolean;
  modifiee: boolean;
};

const CHAMPS_A_COMPLETER = [
  'civilite',
  'prenom',
  'email',
  'telephone',
  'fonction',
  'linkedin',
  'domaine',
] as const;

const depuisLigne = (l: FicheBase): Travail['valeurs'] => ({ ...l });

// A match only fills what the stored record lacks: it never overwrites.
function fusionner(cible: Travail, fiche: Fiche): void {
  const v = cible.valeurs;
  let change = false;
  for (const champ of CHAMPS_A_COMPLETER) {
    if (v[champ] == null && fiche[champ] != null) {
      (v as Record<string, unknown>)[champ] = fiche[champ];
      if (champ === 'civilite') v.civiliteDeduite = fiche.civiliteDeduite;
      change = true;
    }
  }
  const cles = new Set([...(v.cles ?? []), ...clesDoublon(fiche)]);
  if (cles.size !== (v.cles ?? []).length) {
    v.cles = [...cles];
    change = true;
  }
  const fusionnee: Fiche = {
    entreprise: v.entreprise,
    civilite: v.civilite ?? null,
    civiliteDeduite: v.civiliteDeduite ?? false,
    prenom: v.prenom ?? null,
    nom: v.nom || null,
    // An address known to bounce no longer makes the record prospectable.
    email: v.emailInvalide ? null : (v.email ?? null),
    telephone: v.telephone ?? null,
    fonction: v.fonction ?? null,
    linkedin: v.linkedin ?? null,
    domaine: v.domaine ?? null,
  };
  const zone = evaluer(fusionnee);
  if (zone.etat === 'pret' && zone.zone !== v.zone) {
    v.zone = zone.zone;
    change = true;
  }
  if (change) cible.modifiee = true;
}

export async function integrerFiches(
  tx: Tx,
  instanceId: string,
  items: FicheAIntegrer[],
): Promise<Integree[]> {
  const zones = items.map((i) => verifierHomogene(i.fiche));
  const cles = items.map((i) => clesDoublon(i.fiche));

  const touchees = [...new Set(cles.flat())];
  const existantes =
    touchees.length === 0
      ? []
      : await tx
          .select()
          .from(baseVivante)
          .where(
            and(
              eq(baseVivante.instanceId, instanceId),
              sql`${baseVivante.cles} ?| array[${sql.join(touchees, sql`, `)}]::text[]`,
            ),
          );
  const parCle = new Map<string, Travail>();
  const travaux = new Map<string, Travail>();
  const suivre = (t: Travail) => {
    travaux.set(t.valeurs.id, t);
    for (const c of t.valeurs.cles ?? []) parCle.set(c, t);
  };
  for (const e of existantes) suivre({ valeurs: depuisLigne(e), nouvelle: false, modifiee: false });

  const resultats: Integree[] = items.map((item, i) => {
    const trouve = (cles[i] ?? []).map((c) => parCle.get(c)).find((t) => t !== undefined);
    if (trouve) {
      fusionner(trouve, item.fiche);
      suivre(trouve);
      return { id: trouve.valeurs.id, fusionnee: true, zone: trouve.valeurs.zone };
    }
    const f = item.fiche;
    const zone = zones[i] as Zone;
    const travail: Travail = {
      nouvelle: true,
      modifiee: false,
      valeurs: {
        id: randomUUID(),
        instanceId,
        zone,
        entreprise: f.entreprise as string,
        civilite: f.civilite,
        civiliteDeduite: f.civiliteDeduite,
        prenom: f.prenom,
        // The column is not null: « à enrichir » records without a contact keep an empty name.
        nom: f.nom ?? '',
        email: f.email,
        telephone: f.telephone,
        fonction: f.fonction,
        linkedin: f.linkedin,
        domaine: f.domaine,
        provenance: item.provenance,
        mandat: item.mandat,
        importId: item.importId,
        collecteLe: item.collecteLe,
        cles: cles[i] ?? [],
      },
    };
    suivre(travail);
    return { id: travail.valeurs.id, fusionnee: false, zone };
  });

  const nouvelles = [...travaux.values()].filter((t) => t.nouvelle).map((t) => t.valeurs);
  if (nouvelles.length > 0) await tx.insert(baseVivante).values(nouvelles);
  for (const t of travaux.values()) {
    if (t.nouvelle || !t.modifiee) continue;
    await tx
      .update(baseVivante)
      .set({ ...t.valeurs, updatedAt: new Date() })
      .where(and(eq(baseVivante.id, t.valeurs.id), eq(baseVivante.instanceId, instanceId)));
  }
  return resultats;
}

const RESULTATS_REPONDU: Resultat[] = [
  'repondu',
  'interesse',
  'pas_interesse',
  'mauvais_interlocuteur',
];

// Where the prospecting stands, from what is known of the contacts.
export function statutProspectionDe(
  resultat: Resultat | null,
  nbContacts: number,
  dernierContactLe: Date | null,
): StatutProspection {
  if (resultat && RESULTATS_REPONDU.includes(resultat)) return 'a_repondu';
  return nbContacts > 0 || dernierContactLe ? 'contacte' : 'jamais_contacte';
}

export type PatchHistorique = {
  dernierContactLe?: Date | null;
  dernierContactCanal?: string | null;
  resultat?: Resultat | null;
  nbContacts?: number;
  mandatContacteur?: string | null;
};

const zoneDe = (f: Pick<FicheBase, 'nom' | 'email' | 'emailInvalide' | 'telephone'>): Zone =>
  f.nom && ((f.email && !f.emailInvalide) || f.telephone) ? 'prospectable' : 'a_enrichir';

async function charger(tx: Tx, instanceId: string, id: string): Promise<FicheBase> {
  const [fiche] = await tx
    .select()
    .from(baseVivante)
    .where(and(eq(baseVivante.id, id), eq(baseVivante.instanceId, instanceId)));
  if (!fiche) throw new FicheIntrouvable('Fiche introuvable');
  return fiche;
}

export class FicheIntrouvable extends Error {}

// History comes from the CRMs and the mailboxes: it only moves forward in time, and never
// erases a more recent contact with an older one.
export async function majHistorique(
  tx: Tx,
  instanceId: string,
  id: string,
  patch: PatchHistorique,
): Promise<void> {
  const f = await charger(tx, instanceId, id);
  const plusRecent =
    patch.dernierContactLe !== undefined &&
    patch.dernierContactLe !== null &&
    (!f.dernierContactLe || patch.dernierContactLe >= f.dernierContactLe);
  const valeurs = {
    dernierContactLe: plusRecent ? (patch.dernierContactLe ?? null) : f.dernierContactLe,
    dernierContactCanal: plusRecent
      ? (patch.dernierContactCanal ?? f.dernierContactCanal)
      : f.dernierContactCanal,
    mandatContacteur: plusRecent
      ? (patch.mandatContacteur ?? f.mandatContacteur)
      : f.mandatContacteur,
    nbContacts: Math.max(f.nbContacts, patch.nbContacts ?? 0),
    resultat: patch.resultat === undefined ? f.resultat : patch.resultat,
  };
  await tx
    .update(baseVivante)
    .set({
      ...valeurs,
      statutProspection: statutProspectionDe(
        valeurs.resultat,
        valeurs.nbContacts,
        valeurs.dernierContactLe,
      ),
      updatedAt: new Date(),
    })
    .where(and(eq(baseVivante.id, id), eq(baseVivante.instanceId, instanceId)));
}

export type PatchConformite = {
  opposition?: boolean;
  emailInvalide?: boolean;
  exclusion?: Exclusion | null;
};

export async function majConformite(
  tx: Tx,
  instanceId: string,
  id: string,
  patch: PatchConformite,
): Promise<void> {
  const f = await charger(tx, instanceId, id);
  const suivant = { ...f, ...patch };
  await tx
    .update(baseVivante)
    .set({
      opposition: suivant.opposition,
      emailInvalide: suivant.emailInvalide,
      exclusion: suivant.exclusion,
      zone: zoneDe(suivant),
      updatedAt: new Date(),
    })
    .where(and(eq(baseVivante.id, id), eq(baseVivante.instanceId, instanceId)));
}

export type Apport = {
  prenom?: string;
  nom?: string;
  email?: string;
  telephone?: string;
  fonction?: string;
};

// A contact found for a record « à enrichir »: fills what is given, through the same
// normalisation as an import, and moves the record to « prospectable » once it has a name and a
// way to reach it.
export async function enrichir(
  tx: Tx,
  instanceId: string,
  id: string,
  apport: Apport,
): Promise<FicheBase['zone']> {
  const f = await charger(tx, instanceId, id);
  const neuf = (v: string | undefined, ancien: string | null) => v?.trim() || ancien;
  const { fiche, avertissements } = normaliserFiche({
    entreprise: f.entreprise,
    civilite: f.civiliteDeduite ? null : f.civilite,
    prenom: neuf(apport.prenom, f.prenom),
    nom: neuf(apport.nom, f.nom),
    email: neuf(apport.email, f.email),
    telephone: neuf(apport.telephone, f.telephone),
    fonction: neuf(apport.fonction, f.fonction),
    linkedin: f.linkedin,
  });
  if (avertissements.length > 0) throw new FicheNonHomogene(avertissements.join(', '));
  const emailChange = fiche.email !== f.email;
  const suivant = { nom: fiche.nom ?? '', email: fiche.email, telephone: fiche.telephone };
  const zone = zoneDe({ ...suivant, emailInvalide: emailChange ? false : f.emailInvalide });
  await tx
    .update(baseVivante)
    .set({
      civilite: fiche.civilite,
      civiliteDeduite: fiche.civiliteDeduite,
      prenom: fiche.prenom,
      nom: suivant.nom,
      email: fiche.email,
      telephone: fiche.telephone,
      fonction: fiche.fonction,
      domaine: fiche.domaine ?? f.domaine,
      emailInvalide: emailChange ? false : f.emailInvalide,
      cles: [...new Set([...f.cles, ...clesDoublon(fiche)])],
      zone,
      updatedAt: new Date(),
    })
    .where(and(eq(baseVivante.id, id), eq(baseVivante.instanceId, instanceId)));
  return zone;
}

// The record entered the CRM of a mandate: the link is kept for history and duplicates.
export async function lierCrm(
  tx: Tx,
  instanceId: string,
  id: string,
  lien: { crmMandat: string; crmContactId: string },
): Promise<void> {
  await charger(tx, instanceId, id);
  await tx
    .update(baseVivante)
    .set({ ...lien, updatedAt: new Date() })
    .where(and(eq(baseVivante.id, id), eq(baseVivante.instanceId, instanceId)));
}
