import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { SLUG } from '../instances/service.js';
import { indemnitesParTrajet, tranchesValides, type Tranche } from './ik-bareme.js';
import {
  gestionCcaMouvements,
  gestionIkBaremes,
  gestionIkLieux,
  gestionIkMois,
  gestionIkTrajets,
  gestionIkVehicules,
  ORIGINES_DISTANCE,
  type StatutIk,
} from './schema.js';

export class IkIntrouvable extends Error {}
export class IkInvalide extends Error {}

const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const moisIk = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const vehiculeSchema = z.object({
  libelle: z.string().trim().min(1).max(120),
  categorie: z.string().trim().min(1).max(60),
  puissanceFiscale: z.number().int().min(1).max(99).nullish(),
});
export const lieuSchema = z.object({
  nom: z.string().trim().min(1).max(160),
  distanceKm: z.number().int().min(0).max(5000),
  origine: z.enum(ORIGINES_DISTANCE).default('saisie'),
});
export const baremeSchema = z.object({
  annee: z.number().int().min(2000).max(2100),
  categorie: z.string().trim().min(1).max(60),
  source: z.string().trim().min(1).max(300),
  tranches: z
    .array(
      z.object({
        deKm: z.number().int().min(0),
        jusquaKm: z.number().int().positive().nullable(),
        tauxDixMilliemes: z.number().int().min(0),
        forfaitCents: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(10),
});
export const trajetSchema = z.object({
  vehiculeId: z.string().uuid(),
  date: jour,
  trajet: z.string().trim().min(1).max(200),
  commentaire: z.string().trim().min(1).max(500),
  kmAllerRetour: z.number().int().min(1).max(5000),
  origineDistance: z.enum(ORIGINES_DISTANCE).default('saisie'),
  mandat: z.string().regex(SLUG).nullish(),
  justificatif: z.string().trim().max(500).nullish(),
});
export const trajetPatchSchema = trajetSchema.partial();
export const aboSchema = z.object({ abonnement: z.boolean() });

const visible = <T extends { instanceId: unknown; archiveeAt: unknown }>(t: T) =>
  and(eq(t.instanceId as never, currentInstance), isNull(t.archiveeAt as never));

export async function lireConfigIk(tx: Executor) {
  const [vehicules, lieux, baremes, mois] = await Promise.all([
    tx.select().from(gestionIkVehicules).where(visible(gestionIkVehicules)),
    tx.select().from(gestionIkLieux).where(visible(gestionIkLieux)),
    tx
      .select()
      .from(gestionIkBaremes)
      .where(eq(gestionIkBaremes.instanceId, currentInstance))
      .orderBy(desc(gestionIkBaremes.annee), desc(gestionIkBaremes.version)),
    tx.select().from(gestionIkMois).where(eq(gestionIkMois.instanceId, currentInstance)),
  ]);
  return { vehicules, lieux, baremes, mois };
}

export async function creerVehicule(
  tx: Executor,
  instanceId: string,
  v: z.infer<typeof vehiculeSchema>,
) {
  const [l] = await tx
    .insert(gestionIkVehicules)
    .values({ ...v, puissanceFiscale: v.puissanceFiscale ?? null, instanceId })
    .returning();
  return l!;
}

export async function creerLieu(tx: Executor, instanceId: string, v: z.infer<typeof lieuSchema>) {
  const [l] = await tx
    .insert(gestionIkLieux)
    .values({ ...v, instanceId })
    .returning();
  return l!;
}

export async function archiverLieu(tx: Executor, id: string) {
  await tx
    .update(gestionIkLieux)
    .set({ archiveeAt: new Date() })
    .where(and(eq(gestionIkLieux.id, id), eq(gestionIkLieux.instanceId, currentInstance)));
}

// Un nouveau barème est une nouvelle version, jamais une modification : les exports déjà remis
// restent explicables. Il ne sert qu'après validation.
export async function creerBareme(
  tx: Executor,
  instanceId: string,
  b: z.infer<typeof baremeSchema>,
) {
  if (!tranchesValides(b.tranches))
    throw new IkInvalide(
      'Tranches incohérentes : la première commence à 0 km, elles se suivent sans trou et la dernière est sans plafond.',
    );
  const [derniere] = await tx
    .select({ version: gestionIkBaremes.version })
    .from(gestionIkBaremes)
    .where(
      and(
        eq(gestionIkBaremes.instanceId, currentInstance),
        eq(gestionIkBaremes.annee, b.annee),
        eq(gestionIkBaremes.categorie, b.categorie),
      ),
    )
    .orderBy(desc(gestionIkBaremes.version))
    .limit(1);
  const [l] = await tx
    .insert(gestionIkBaremes)
    .values({ ...b, version: (derniere?.version ?? 0) + 1, instanceId })
    .returning();
  return l!;
}

export async function validerBareme(tx: Executor, id: string, aujourdhui: string) {
  const [l] = await tx
    .update(gestionIkBaremes)
    .set({ valideLe: aujourdhui, updatedAt: new Date() })
    .where(and(eq(gestionIkBaremes.id, id), eq(gestionIkBaremes.instanceId, currentInstance)))
    .returning();
  if (!l) throw new IkIntrouvable('Barème introuvable');
  return l;
}

export async function poserAbonnement(
  tx: Executor,
  instanceId: string,
  mois: string,
  abonnement: boolean,
) {
  await tx
    .insert(gestionIkMois)
    .values({ instanceId, mois, abonnement })
    .onConflictDoUpdate({
      target: [gestionIkMois.instanceId, gestionIkMois.mois],
      set: { abonnement, updatedAt: new Date() },
    });
}

const finDeMois = (mois: string) => {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  return `${mois}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

export async function lireTrajet(tx: Executor, id: string) {
  const [t] = await tx
    .select()
    .from(gestionIkTrajets)
    .where(and(eq(gestionIkTrajets.id, id), visible(gestionIkTrajets)));
  if (!t) throw new IkIntrouvable('Trajet introuvable');
  return t;
}

// Ne jamais déclarer deux fois le même trajet le même jour avec le même véhicule.
async function verifierDoublon(
  tx: Executor,
  t: { vehiculeId: string; date: string; trajet: string },
  sauf?: string,
) {
  const memes = await tx
    .select({ id: gestionIkTrajets.id })
    .from(gestionIkTrajets)
    .where(
      and(
        visible(gestionIkTrajets),
        eq(gestionIkTrajets.vehiculeId, t.vehiculeId),
        eq(gestionIkTrajets.date, t.date),
        eq(gestionIkTrajets.trajet, t.trajet),
      ),
    );
  if (memes.some((m) => m.id !== sauf))
    throw new IkInvalide('Ce trajet existe déjà à cette date pour ce véhicule.');
}

export async function creerTrajet(
  tx: Executor,
  instanceId: string,
  t: z.infer<typeof trajetSchema>,
) {
  await verifierDoublon(tx, t);
  const [l] = await tx
    .insert(gestionIkTrajets)
    .values({ ...t, mandat: t.mandat ?? null, justificatif: t.justificatif ?? null, instanceId })
    .returning();
  return l!;
}

const FIGES: StatutIk[] = ['valide', 'comptabilise', 'rembourse'];

export async function modifierTrajet(
  tx: Executor,
  id: string,
  patch: z.infer<typeof trajetPatchSchema>,
) {
  const actuel = await lireTrajet(tx, id);
  if (FIGES.includes(actuel.statut))
    throw new IkInvalide(
      'Un trajet validé pour transmission ne se modifie plus : rouvrez le mois.',
    );
  await verifierDoublon(tx, { ...actuel, ...patch }, id);
  const [l] = await tx
    .update(gestionIkTrajets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(gestionIkTrajets.id, id))
    .returning();
  return l!;
}

export async function archiverTrajet(tx: Executor, id: string) {
  const actuel = await lireTrajet(tx, id);
  if (FIGES.includes(actuel.statut))
    throw new IkInvalide('Un trajet validé pour transmission ne se supprime plus.');
  await tx
    .update(gestionIkTrajets)
    .set({ archiveeAt: new Date() })
    .where(eq(gestionIkTrajets.id, id));
}

export type LigneIk = {
  id: string;
  date: string;
  trajet: string;
  commentaire: string;
  km: number;
  origineDistance: string;
  mandat: string | null;
  justificatif: string | null;
  statut: StatutIk;
  cumulKm: number;
  // null = pas de barème validé : le trajet est saisi, mais aucun montant n'est inventé.
  indemniteCents: number | null;
};

export type EtatIkMois = {
  mois: string;
  vehiculeId: string;
  abonnement: boolean | null;
  bareme: { id: string; annee: number; version: number; source: string; valideLe: string } | null;
  lignes: LigneIk[];
  totalKm: number;
  totalIndemniteCents: number | null;
  cumulAnnuelKm: number;
  derniereDateTransmise: string | null;
  // Mouvement CCA déjà créé pour ce mois, et écart si le calcul a changé depuis.
  cca: { montantCents: number; ecartCents: number } | null;
  avertissements: string[];
};

// Le plus récent des barèmes validés ; un brouillon plus récent n'écrase pas le validé.
async function baremeValide(tx: Executor, annee: number, categorie: string) {
  const versions = await tx
    .select()
    .from(gestionIkBaremes)
    .where(
      and(
        eq(gestionIkBaremes.instanceId, currentInstance),
        eq(gestionIkBaremes.annee, annee),
        eq(gestionIkBaremes.categorie, categorie),
      ),
    )
    .orderBy(desc(gestionIkBaremes.version));
  return versions.find((x) => x.valideLe != null) ?? null;
}

export const refCcaIk = (mois: string, vehiculeId: string, suffixe: 'ik' | 'ik-remb' = 'ik') =>
  `${suffixe}:${mois}:${vehiculeId}`;

// Les IK d'un mois sont la différence entre le cumul annuel après et avant le mois, jamais
// « kilomètres × taux » : le barème est progressif.
export async function etatIkMois(
  tx: Executor,
  mois: string,
  vehiculeId: string,
): Promise<EtatIkMois> {
  const [vehicule] = await tx
    .select()
    .from(gestionIkVehicules)
    .where(and(eq(gestionIkVehicules.id, vehiculeId), visible(gestionIkVehicules)));
  if (!vehicule) throw new IkIntrouvable('Véhicule introuvable');
  const annee = Number(mois.slice(0, 4));
  const trajets = await tx
    .select()
    .from(gestionIkTrajets)
    .where(
      and(
        visible(gestionIkTrajets),
        eq(gestionIkTrajets.vehiculeId, vehiculeId),
        gte(gestionIkTrajets.date, `${annee}-01-01`),
        lte(gestionIkTrajets.date, finDeMois(mois)),
      ),
    )
    .orderBy(asc(gestionIkTrajets.date), asc(gestionIkTrajets.createdAt));
  const avant = trajets.filter((t) => t.date < `${mois}-01`);
  const duMois = trajets.filter((t) => t.date >= `${mois}-01`);
  const kmAvant = avant.reduce((s, t) => s + t.kmAllerRetour, 0);

  const bareme = await baremeValide(tx, annee, vehicule.categorie);
  const tranches: Tranche[] | null = bareme?.tranches ?? null;
  const calcul = tranches
    ? indemnitesParTrajet(
        tranches,
        kmAvant,
        duMois.map((t) => t.kmAllerRetour),
      )
    : null;
  const lignes: LigneIk[] = duMois.map((t, i) => ({
    id: t.id,
    date: t.date,
    trajet: t.trajet,
    commentaire: t.commentaire,
    km: t.kmAllerRetour,
    origineDistance: t.origineDistance,
    mandat: t.mandat,
    justificatif: t.justificatif,
    statut: t.statut,
    cumulKm: calcul
      ? calcul[i]!.cumulKm
      : kmAvant + duMois.slice(0, i + 1).reduce((s, x) => s + x.kmAllerRetour, 0),
    indemniteCents: calcul ? calcul[i]!.indemniteCents : null,
  }));
  const totalKm = lignes.reduce((s, l) => s + l.km, 0);
  const totalIndemniteCents = calcul ? calcul.reduce((s, l) => s + l.indemniteCents, 0) : null;

  const [abo] = await tx
    .select()
    .from(gestionIkMois)
    .where(and(eq(gestionIkMois.instanceId, currentInstance), eq(gestionIkMois.mois, mois)));
  // « Transmis » = au moins validé pour transmission : sert à ne jamais redéclarer une date.
  const transmis = (
    await tx
      .select({ date: gestionIkTrajets.date, statut: gestionIkTrajets.statut })
      .from(gestionIkTrajets)
      .where(and(visible(gestionIkTrajets), eq(gestionIkTrajets.vehiculeId, vehiculeId)))
      .orderBy(desc(gestionIkTrajets.date))
  ).find((t) => FIGES.includes(t.statut));

  const [mvt] = await tx
    .select()
    .from(gestionCcaMouvements)
    .where(
      and(
        eq(gestionCcaMouvements.instanceId, currentInstance),
        eq(gestionCcaMouvements.refSource, refCcaIk(mois, vehiculeId)),
      ),
    );

  const avertissements: string[] = [];
  if (!bareme)
    avertissements.push(
      `Aucun barème validé pour ${annee} (${vehicule.categorie}) : les trajets sont saisis sans montant d'IK.`,
    );
  if (abo == null)
    avertissements.push(
      "Abonnement de transport de ce mois non renseigné : une IK n'est justifiée que si aucun transport n'a été payé sur le compte professionnel.",
    );

  return {
    mois,
    vehiculeId,
    abonnement: abo?.abonnement ?? null,
    bareme: bareme
      ? {
          id: bareme.id,
          annee: bareme.annee,
          version: bareme.version,
          source: bareme.source,
          valideLe: bareme.valideLe!,
        }
      : null,
    lignes,
    totalKm,
    totalIndemniteCents,
    cumulAnnuelKm: kmAvant + totalKm,
    derniereDateTransmise: transmis?.date ?? null,
    cca: mvt
      ? {
          montantCents: mvt.montantCents,
          ecartCents: (totalIndemniteCents ?? mvt.montantCents) - mvt.montantCents,
        }
      : null,
    avertissements,
  };
}

// Avancement du mois entier, un cran à la fois. « Comptabilisé » et « remboursé » créent leur
// mouvement de compte d'associé une seule fois (clé de source), même si l'on relance le calcul.
const TRANSITIONS: Record<string, { de: StatutIk; vers: StatutIk }> = {
  a_controler: { de: 'brouillon', vers: 'a_controler' },
  valide: { de: 'a_controler', vers: 'valide' },
  rouvrir: { de: 'valide', vers: 'a_controler' },
  comptabilise: { de: 'valide', vers: 'comptabilise' },
  rembourse: { de: 'comptabilise', vers: 'rembourse' },
};
export const ACTIONS_MOIS = Object.keys(TRANSITIONS) as [string, ...string[]];
export const avancerSchema = z.object({
  vehiculeId: z.string().uuid(),
  action: z.enum(ACTIONS_MOIS),
  // Date et source du mouvement de compte d'associé (comptabilisation / remboursement).
  date: jour.optional(),
  source: z.string().trim().min(1).max(300).optional(),
});

export async function avancerMois(
  tx: Executor,
  instanceId: string,
  mois: string,
  e: z.infer<typeof avancerSchema>,
) {
  const tr = TRANSITIONS[e.action]!;
  const etat = await etatIkMois(tx, mois, e.vehiculeId);
  const concernees = etat.lignes.filter((l) => l.statut === tr.de);
  if (concernees.length === 0)
    throw new IkInvalide(`Aucun trajet de ce mois au statut « ${tr.de.replace('_', ' ')} ».`);
  if (e.action === 'valide' && etat.abonnement == null)
    throw new IkInvalide("Indiquez d'abord si le mois a un abonnement de transport.");
  const compta = e.action === 'comptabilise' || e.action === 'rembourse';
  if (compta) {
    if (etat.totalIndemniteCents == null)
      throw new IkInvalide("Aucun barème validé : pas de montant d'IK à comptabiliser.");
    if (!e.date || !e.source)
      throw new IkInvalide('Précisez la date et la source (écriture du comptable, virement…).');
    const rembourse = e.action === 'rembourse';
    await tx
      .insert(gestionCcaMouvements)
      .values({
        instanceId,
        date: e.date,
        type: rembourse ? 'remboursement' : 'ik',
        libelle: `${rembourse ? 'Remboursement des IK' : 'IK'} ${mois}`,
        montantCents: rembourse ? -etat.totalIndemniteCents : etat.totalIndemniteCents,
        etat: 'comptabilise',
        source: e.source,
        refSource: refCcaIk(mois, e.vehiculeId, rembourse ? 'ik-remb' : 'ik'),
      })
      .onConflictDoNothing();
  }
  for (const l of concernees)
    await tx
      .update(gestionIkTrajets)
      .set({ statut: tr.vers, updatedAt: new Date() })
      .where(eq(gestionIkTrajets.id, l.id));
  return etatIkMois(tx, mois, e.vehiculeId);
}

// CSV pour le comptable : les colonnes de son suivi d'abord, puis le détail de l'article 15.5.
// Séparateur « ; » et BOM pour une ouverture directe dans un tableur français. Ce n'est pas une
// pièce fiscale : il le dit. Les péages n'y figurent jamais.
const cellule = (v: string | number | null) => {
  let s = v == null ? '' : String(v);
  // Neutralise l'injection de formule à l'ouverture dans un tableur.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const euros = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

export async function exporterCsv(
  tx: Executor,
  mois: string,
  vehiculeId: string,
  edition: { date: string; version: number },
) {
  const etat = await etatIkMois(tx, mois, vehiculeId);
  const [v] = await tx
    .select()
    .from(gestionIkVehicules)
    .where(eq(gestionIkVehicules.id, vehiculeId));
  const en = [
    'Date',
    'Trajet',
    'Commentaire',
    'Distance A/R (km)',
    'Indemnité (€)',
    'Exercice',
    'Véhicule',
    'Cumul annuel (km)',
    'Barème',
    'Justificatif',
    'Statut',
    'Version',
    "Date d'édition",
  ];
  const ref = etat.bareme
    ? `${etat.bareme.annee} v${etat.bareme.version} — ${etat.bareme.source}`
    : 'non validé';
  const lignes = etat.lignes.map((l) =>
    [
      l.date,
      l.trajet,
      l.commentaire,
      l.km,
      euros(l.indemniteCents),
      mois.slice(0, 4),
      v?.libelle ?? '',
      l.cumulKm,
      ref,
      l.justificatif ?? '',
      l.statut.replace('_', ' '),
      edition.version,
      edition.date,
    ]
      .map(cellule)
      .join(';'),
  );
  const total = ['Total', '', '', etat.totalKm, euros(etat.totalIndemniteCents)]
    .map(cellule)
    .join(';');
  const note = cellule(
    "Document de préparation édité par SIMATIS OS : ce n'est pas une pièce fiscale validée. Péages exclus.",
  );
  return `﻿${[en.map(cellule).join(';'), ...lignes, total, note].join('\r\n')}\r\n`;
}
