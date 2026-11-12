import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withInstance } from '../db/context.js';
import type { Database } from '../db.js';
import { jourDe } from '../pilotage/realisees.js';
import { preferences } from '../preferences/schema.js';
import { creerLienProspectionVma, type InvitationDeps } from '../vma/invitations.js';
import { creerCampagneFroid, echantillonFroid } from './froid.js';
import { reglageParDefaut } from './campagnes.js';
import { prospectionBrouillons, prospectionCampagnes } from './schema.js';
import { listerSignatures } from './signatures.js';

export const schemaRoutineBrouillons = z.object({
  active: z.boolean(),
  heure: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
});
export type RoutineBrouillons = z.infer<typeof schemaRoutineBrouillons> & {
  dernierJour?: string;
  bilan?: string;
};
const prefixe = 'routine-brouillons:';

export async function lireRoutineBrouillons(
  db: Database,
  instanceId: string,
): Promise<RoutineBrouillons> {
  const [p] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.utilisateur, prefixe + instanceId));
  return p?.options.brouillons ?? { active: false, heure: '10:00' };
}

export async function sauverRoutineBrouillons(
  db: Database,
  instanceId: string,
  r: z.infer<typeof schemaRoutineBrouillons>,
) {
  await db
    .insert(preferences)
    .values({
      utilisateur: prefixe + instanceId,
      favoris: [],
      options: { brouillons: r },
    })
    .onConflictDoUpdate({
      target: preferences.utilisateur,
      set: {
        options: sql`jsonb_build_object('brouillons', coalesce(${preferences.options}->'brouillons', '{}'::jsonb) || ${JSON.stringify(r)}::jsonb)`,
      },
    });
  return lireRoutineBrouillons(db, instanceId);
}

export async function preparerBrouillonsVma(db: Database, instanceId: string, vma: InvitationDeps) {
  let crees = 0;
  for (;;) {
    const nombre = await withInstance(db, instanceId, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${'prospection-froid:' + instanceId}))`,
      );
      const candidats = await echantillonFroid(tx, { nombre: 20_000 });
      if (!candidats.length) return 0;
      const deja = await tx
        .select({ baseId: prospectionBrouillons.baseId })
        .from(prospectionBrouillons)
        .innerJoin(
          prospectionCampagnes,
          eq(prospectionCampagnes.id, prospectionBrouillons.campagneId),
        )
        .where(
          and(
            eq(prospectionBrouillons.instanceId, instanceId),
            inArray(
              prospectionBrouillons.baseId,
              candidats.map((c) => c.id),
            ),
            // A pending draft or an earlier VMA campaign prevents another automatic first contact.
            sql`(${prospectionCampagnes.statut} <> 'terminee' or ${prospectionCampagnes.reglage}->>'offre' = 'vma')`,
          ),
        );
      const connus = new Set(deja.map((b) => b.baseId));
      const ids = candidats
        .filter((c) => c.touche === 1 && !connus.has(c.id))
        .slice(0, 60)
        .map((c) => c.id);
      if (!ids.length) return 0;
      const signatures = await listerSignatures(tx);
      const reglage = {
        ...reglageParDefaut(),
        creneaux: false,
        signatureId: signatures.find((s) => s.defaut)?.id ?? null,
      };
      const campagne = await creerCampagneFroid(tx, { baseIds: ids, reglage });
      const brouillons = await tx
        .select()
        .from(prospectionBrouillons)
        .where(eq(prospectionBrouillons.campagneId, campagne.campagneId));
      for (const b of brouillons) {
        const { lien } = await creerLienProspectionVma(vma);
        await tx
          .update(prospectionBrouillons)
          .set({
            lienVma: lien,
            consigne:
              'Rédige le premier contact via la skill prospecter-par-mail-simatis. Propose le formulaire VMA avec le lien individuel fourni.',
          })
          .where(eq(prospectionBrouillons.id, b.id));
      }
      return brouillons.length;
    });
    crees += nombre;
    if (!nombre) return crees;
  }
}

// Relances préparées par jour : de quoi relire sans submerger. Les premiers mails gardent leur
// fonctionnement habituel (par lots de 60).
export const RELANCES_PAR_JOUR = 30;

// Les relances dont le délai de la séquence est écoulé : un brouillon par contact, avec deux
// créneaux libres de l'agenda, repris sur l'angle du premier mail (même lien individuel). Rien n'est
// envoyé : chaque brouillon passe par la rédaction puis par la relecture du pilote.
export async function preparerRelancesVma(
  db: Database,
  instanceId: string,
  vma: InvitationDeps,
): Promise<number> {
  return withInstance(db, instanceId, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${'prospection-froid:' + instanceId}))`,
    );
    const candidats = (await echantillonFroid(tx, { nombre: 20_000 })).filter((c) => c.touche >= 2);
    if (!candidats.length) return 0;
    const enAttente = await tx
      .select({ baseId: prospectionBrouillons.baseId })
      .from(prospectionBrouillons)
      .innerJoin(
        prospectionCampagnes,
        eq(prospectionCampagnes.id, prospectionBrouillons.campagneId),
      )
      .where(
        and(
          eq(prospectionBrouillons.instanceId, instanceId),
          inArray(
            prospectionBrouillons.baseId,
            candidats.map((c) => c.id),
          ),
          sql`${prospectionCampagnes.statut} <> 'terminee'`,
        ),
      );
    const reserves = new Set(enAttente.map((b) => b.baseId));
    const ids = candidats
      .filter((c) => !reserves.has(c.id))
      .slice(0, RELANCES_PAR_JOUR)
      .map((c) => c.id);
    if (!ids.length) return 0;
    const signatures = await listerSignatures(tx);
    const reglage = {
      ...reglageParDefaut(),
      creneaux: true,
      signatureId: signatures.find((s) => s.defaut)?.id ?? null,
    };
    const campagne = await creerCampagneFroid(tx, { baseIds: ids, reglage });
    const brouillons = await tx
      .select()
      .from(prospectionBrouillons)
      .where(eq(prospectionBrouillons.campagneId, campagne.campagneId));
    // Le lien individuel déjà donné à ce contact lors d'une touche précédente est repris.
    const anciens = await tx
      .select({ baseId: prospectionBrouillons.baseId, lien: prospectionBrouillons.lienVma })
      .from(prospectionBrouillons)
      .where(
        and(
          eq(prospectionBrouillons.instanceId, instanceId),
          inArray(
            prospectionBrouillons.baseId,
            brouillons.flatMap((b) => (b.baseId ? [b.baseId] : [])),
          ),
          sql`${prospectionBrouillons.lienVma} is not null`,
          sql`${prospectionBrouillons.campagneId} <> ${campagne.campagneId}`,
        ),
      )
      .orderBy(sql`${prospectionBrouillons.createdAt} desc`);
    const lienDe = new Map<string, string>();
    for (const a of anciens)
      if (a.baseId && a.lien && !lienDe.has(a.baseId)) lienDe.set(a.baseId, a.lien);
    for (const b of brouillons) {
      const lien = (b.baseId && lienDe.get(b.baseId)) || (await creerLienProspectionVma(vma)).lien;
      await tx
        .update(prospectionBrouillons)
        .set({
          lienVma: lien,
          consigne: `Rédige la relance numéro ${b.touche} via la skill relancer-par-mail-simatis : rappel court, angle différent des mails précédents, et propose deux créneaux de rendez-vous. Reprends le formulaire VMA avec le lien individuel fourni.`,
        })
        .where(eq(prospectionBrouillons.id, b.id));
    }
    return brouillons.length;
  });
}

export async function tournerBrouillons(
  db: Database,
  vma: InvitationDeps | null,
  maintenant = new Date(),
) {
  if (!vma) return;
  const jour = jourDe(maintenant);
  const heure = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(maintenant);
  const lignes = await db
    .select()
    .from(preferences)
    .where(sql`${preferences.utilisateur} like ${prefixe + '%'}`);
  for (const p of lignes) {
    const r = p.options.brouillons;
    if (!r?.active || r.heure > heure || r.dernierJour === jour) continue;
    const [prise] = await db
      .update(preferences)
      .set({
        options: { brouillons: { ...r, dernierJour: jour, bilan: 'Préparation en cours…' } },
      })
      .where(
        and(
          eq(preferences.utilisateur, p.utilisateur),
          sql`${preferences.options} = ${JSON.stringify(p.options)}::jsonb`,
        ),
      )
      .returning({ id: preferences.utilisateur });
    if (!prise) continue;
    let bilan: string;
    try {
      const instanceId = p.utilisateur.slice(prefixe.length);
      const premiers = await preparerBrouillonsVma(db, instanceId, vma);
      const relances = await preparerRelancesVma(db, instanceId, vma);
      bilan = `${premiers + relances} brouillon(s) transmis à la rédaction via les skills (${premiers} premier(s) mail(s), ${relances} relance(s)).`;
    } catch {
      bilan = 'Préparation interrompue. Vérifiez la configuration du site VMA.';
    }
    await db
      .update(preferences)
      .set({
        options: sql`jsonb_set(${preferences.options}, '{brouillons,bilan}', to_jsonb(${bilan}::text))`,
      })
      .where(eq(preferences.utilisateur, p.utilisateur));
  }
}
