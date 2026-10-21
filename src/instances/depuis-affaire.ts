import { and, eq, sql } from 'drizzle-orm';
import { contacts, entreprises, opportunites } from '../crm/schema.js';
import { assurerLiensPrincipaux } from '../crm/liens.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import { brancherConnexions, slugLibre } from '../demo/service.js';
import { logEvent } from '../journal/service.js';
import { instances, type Instance } from './schema.js';
import { createInstance } from './service.js';

export class MandatRefuse extends Error {}

// The instances table is not instance-isolated: the link lives in the mandate's config.
export async function mandatLie(
  db: Executor,
  opportuniteId: string,
): Promise<{ slug: string; nom: string } | null> {
  const [row] = await db
    .select({ slug: instances.slug, nom: instances.nom })
    .from(instances)
    .where(
      and(
        eq(instances.type, 'mandat'),
        eq(instances.statut, 'actif'),
        sql`${instances.config} -> 'origine' ->> 'opportuniteId' = ${opportuniteId}`,
      ),
    );
  return row ?? null;
}

async function lireAffaire(tx: Tx, propre: Instance, opportuniteId: string) {
  if (propre.type !== 'propre') {
    throw new MandatRefuse('Un mandat se crée depuis une affaire de Mon activité.');
  }
  // One mandate per deal: simultaneous requests on the same deal wait for each other, so the
  // second one sees the link made by the first.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mandat:${opportuniteId}`}))`);
  const deja = await mandatLie(tx, opportuniteId);
  if (deja) throw new MandatRefuse(`Affaire déjà liée au mandat ${deja.nom}.`);
  return withInstance(tx, propre.id, async (itx) => {
    const [affaire] = await itx
      .select()
      .from(opportunites)
      .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.id, opportuniteId)));
    if (!affaire) throw new MandatRefuse('Affaire introuvable dans Mon activité.');
    return affaire;
  });
}

// The deal is close to signature: the mandate starts in closing with a one-time copy of the
// company and its contacts (no sync afterwards). Quotes stay in the own activity.
export async function creerMandatDepuisAffaire(
  db: Executor,
  propre: Instance,
  opportuniteId: string,
  { crm }: { crm: 'hubspot' | null },
): Promise<Instance> {
  return db.transaction(async (tx) => {
    const affaire = await lireAffaire(tx, propre, opportuniteId);
    if (!affaire.entrepriseId) throw new MandatRefuse("L'affaire n'a pas d'entreprise.");
    const entrepriseId = affaire.entrepriseId;
    const { entreprise, personnes } = await withInstance(tx, propre.id, async (itx) => {
      const [e] = await itx
        .select()
        .from(entreprises)
        .where(and(eq(entreprises.instanceId, currentInstance), eq(entreprises.id, entrepriseId)));
      const p = await itx
        .select()
        .from(contacts)
        .where(
          and(eq(contacts.instanceId, currentInstance), eq(contacts.entrepriseId, entrepriseId)),
        );
      return { entreprise: e, personnes: p };
    });
    if (!entreprise) throw new MandatRefuse("L'affaire n'a pas d'entreprise.");

    const mandat = await createInstance(tx, {
      slug: await slugLibre(tx, entreprise.nom),
      nom: entreprise.nom,
      type: 'mandat',
      config: {
        sous: 'Mandat',
        phase: 'closing',
        ecrituresReelles: false,
        origine: { opportuniteId, entrepriseId },
      },
    });
    await withInstance(tx, mandat.id, async (itx) => {
      const [copie] = await itx
        .insert(entreprises)
        .values({
          instanceId: mandat.id,
          source: 'simatis',
          sourceId: entreprise.id,
          nom: entreprise.nom,
          secteur: entreprise.secteur,
          ville: entreprise.ville,
          taille: entreprise.taille,
          domaine: entreprise.domaine,
        })
        .returning({ id: entreprises.id });
      if (personnes.length > 0) {
        const copies = await itx
          .insert(contacts)
          .values(
            personnes.map((c) => ({
              instanceId: mandat.id,
              source: 'simatis',
              sourceId: c.id,
              entrepriseId: copie?.id ?? null,
              nom: c.nom,
              fonction: c.fonction,
              email: c.email,
              telephone: c.telephone,
              role: c.role,
            })),
          )
          .returning({ id: contacts.id });
        for (const c of copies) await assurerLiensPrincipaux(itx, 'contact', c.id);
      }
      await brancherConnexions(itx, crm);
      await logEvent(itx, {
        acteur: 'pilote',
        action: `Créé depuis une affaire de Mon activité (fiche et ${personnes.length} contact${personnes.length > 1 ? 's' : ''} recopiés)`,
        niveau: 'L2',
      });
    });
    await withInstance(tx, propre.id, (itx) =>
      logEvent(itx, {
        acteur: 'pilote',
        action: `Mandat créé depuis l'affaire ${affaire.titre} : ${mandat.nom}`,
        niveau: 'L2',
      }),
    );
    return mandat;
  });
}

// For mandates created before: only the link, nothing is copied.
export async function lierMandat(
  db: Executor,
  propre: Instance,
  opportuniteId: string,
  slug: string,
): Promise<Instance> {
  return db.transaction(async (tx) => {
    const affaire = await lireAffaire(tx, propre, opportuniteId);
    const [cible] = await tx
      .select()
      .from(instances)
      .where(
        and(eq(instances.slug, slug), eq(instances.type, 'mandat'), eq(instances.statut, 'actif')),
      )
      // Two deals linked to the same mandate at once: the second waits and sees the first link.
      .for('update');
    if (!cible) throw new MandatRefuse('Seul un mandat actif peut être lié à une affaire.');
    if (cible.config.origine) throw new MandatRefuse(`${cible.nom} est déjà lié à une affaire.`);
    const [row] = await tx
      .update(instances)
      .set({
        config: {
          ...cible.config,
          origine: { opportuniteId, entrepriseId: affaire.entrepriseId },
        },
        updatedAt: new Date(),
      })
      .where(eq(instances.id, cible.id))
      .returning();
    await withInstance(tx, propre.id, (itx) =>
      logEvent(itx, {
        acteur: 'pilote',
        action: `Affaire ${affaire.titre} liée au mandat ${cible.nom}`,
        niveau: 'L2',
      }),
    );
    return row ?? cible;
  });
}
