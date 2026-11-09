import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { LecteurWeb } from '../site-entreprise/reseau.js';
import { lireSite } from '../site-entreprise/lire-site.js';
import { EntrepriseIntrouvable } from './entreprises.js';
import { completerEmailEntreprise } from './integration.js';
import { baseEntreprises, baseVivante, type EntrepriseBase } from './schema.js';

export class SiteIntrouvable extends Error {}

// « exemple.test » typed without scheme is read as https.
const adresseDe = (saisie: string): string => {
  const t = saisie.trim();
  if (t.length > 300) throw new SiteIntrouvable('Adresse de site trop longue.');
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
};

// Where to look when nobody gave the address: the site already known, else the domain most of
// the company's contacts write from (a webmail address has no domain here).
async function adresseConnue(
  db: Executor,
  instanceId: string,
  e: { id: string; siteWeb: string | null },
): Promise<string | null> {
  if (e.siteWeb) return e.siteWeb;
  const [d] = await withInstance(db, instanceId, (tx) =>
    tx
      .select({ domaine: baseVivante.domaine, n: sql<number>`count(*)::int` })
      .from(baseVivante)
      .where(
        and(
          eq(baseVivante.instanceId, instanceId),
          eq(baseVivante.entrepriseId, e.id),
          isNotNull(baseVivante.domaine),
        ),
      )
      .groupBy(baseVivante.domaine)
      .orderBy(sql`count(*) desc`, baseVivante.domaine)
      .limit(1),
  );
  return d?.domaine ? `https://${d.domaine}` : null;
}

export async function lireSiteEntreprise(
  db: Executor,
  lecteur: LecteurWeb,
  instanceId: string,
  entrepriseId: string,
  saisie?: string,
): Promise<EntrepriseBase> {
  const [e] = await withInstance(db, instanceId, (tx) =>
    tx
      .select({
        id: baseEntreprises.id,
        siren: baseEntreprises.siren,
        siteWeb: baseEntreprises.siteWeb,
      })
      .from(baseEntreprises)
      .where(and(eq(baseEntreprises.id, entrepriseId), eq(baseEntreprises.instanceId, instanceId))),
  );
  if (!e) throw new EntrepriseIntrouvable('Entreprise introuvable');
  const depart = saisie?.trim() ? adresseDe(saisie) : await adresseConnue(db, instanceId, e);
  if (!depart)
    throw new SiteIntrouvable('Aucun site connu pour cette entreprise : saisissez son adresse.');
  const site = await lireSite(lecteur, depart, e.siren);
  return withInstance(db, instanceId, async (tx) => {
    const [maj] = await tx
      .update(baseEntreprises)
      .set({
        siteWeb: site.url,
        siteTelephones: site.telephones,
        siteEmails: site.emails,
        linkedin: site.linkedin,
        siteConfirme: site.confirme,
        siteLuLe: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(baseEntreprises.id, entrepriseId), eq(baseEntreprises.instanceId, instanceId)))
      .returning();
    if (!maj) throw new EntrepriseIntrouvable('Entreprise introuvable');
    if (site.emails[0])
      await completerEmailEntreprise(tx, instanceId, entrepriseId, site.emails[0]);
    return maj;
  });
}
