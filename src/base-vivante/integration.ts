import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db.js';
import { evaluer, type Zone } from './completude.js';
import { clesDoublon, normaliserFiche, type Fiche } from './nettoyage.js';
import { baseVivante, type FicheBase } from './schema.js';

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
    nom: v.nom,
    email: v.email ?? null,
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
        nom: f.nom as string,
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
