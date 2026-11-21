import { and, eq, sql } from 'drizzle-orm';
import type { ConnexionDeps } from '../connexions/service.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { contactsParEmails, normaliserEmail } from './emails.js';
import { ChangementInvalide, createOpportunite, pipelineSource } from './pipeline.js';
import { activites, contacts, entreprises, opportunites } from './schema.js';
import { createContact, createEntreprise, type Simulation } from './service.js';

export type EntreeRadar = {
  prenom?: string | null;
  nom: string;
  entreprise?: string | null;
  email?: string | null;
  fonction?: string | null;
  lienLinkedin?: string | null;
  origine?: string | null;
  canal: 'Téléphone' | 'LinkedIn' | 'E-mail' | 'À préciser';
  etape?: 0 | 1 | 2 | 3;
  note?: string | null;
  // Contact déjà connu, choisi dans les suggestions du formulaire.
  contactId?: string | null;
};

const vide = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

// Une personne approchée hors de l'OS entre dans le Radar : une affaire à la première étape du
// Pipeline, placée à la main sur l'étape et le canal choisis. Les briques de création ouvrent
// chacune leur transaction (et écrivent dans le CRM quand l'espace en a un) : une erreur en cours
// de route peut laisser l'entreprise ou le contact créés, et un nouvel essai les réutilise.
export async function ajouterAuRadar(
  db: Executor,
  instance: Instance,
  input: EntreeRadar,
  deps: ConnexionDeps,
): Promise<{ id: string; contactId: string } | Simulation> {
  const email = vide(input.email) ? normaliserEmail(input.email as string) : null;
  const nomEntreprise = vide(input.entreprise);

  // Lectures seules d'abord : un refus ne doit rien laisser derrière lui.
  const prepare = await withInstance(db, instance.id, async (tx) => {
    const etape = (await pipelineSource(tx)).etapes[0]?.id;
    if (!etape) throw new ChangementInvalide('Le Pipeline n’a aucune étape ouverte.');
    let contactId = input.contactId ?? null;
    if (contactId) {
      const [c] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, contactId)));
      if (!c) throw new ChangementInvalide('Contact introuvable dans cette instance');
    } else if (email) {
      contactId = (await contactsParEmails(tx, [email])).get(email) ?? null;
    }
    if (contactId) {
      const [ouverte] = await tx
        .select({ id: opportunites.id })
        .from(opportunites)
        .where(
          and(
            eq(opportunites.instanceId, currentInstance),
            eq(opportunites.contactId, contactId),
            sql`${opportunites.clos} is null`,
          ),
        )
        .limit(1);
      if (ouverte) throw new ChangementInvalide('Ce contact a déjà une affaire ouverte.');
    }
    let entrepriseId: string | null = null;
    if (nomEntreprise) {
      const [e] = await tx
        .select({ id: entreprises.id })
        .from(entreprises)
        .where(
          and(
            eq(entreprises.instanceId, currentInstance),
            sql`lower(${entreprises.nom}) = lower(${nomEntreprise})`,
          ),
        )
        .limit(1);
      entrepriseId = e?.id ?? null;
    }
    return { etape, contactId, entrepriseId };
  });

  let { contactId, entrepriseId } = prepare;
  if (!entrepriseId && nomEntreprise) {
    const e = await createEntreprise(db, instance, { nom: nomEntreprise }, deps);
    if ('simulation' in e) return e;
    entrepriseId = e.id;
  }
  const nomComplet = [vide(input.prenom), input.nom.trim()].filter(Boolean).join(' ');
  if (!contactId) {
    const c = await createContact(
      db,
      instance,
      {
        nom: nomComplet,
        fonction: vide(input.fonction),
        email,
        entrepriseId,
      },
      deps,
    );
    if ('simulation' in c) return c;
    contactId = c.id;
  }

  const affaire = await createOpportunite(
    db,
    instance,
    { titre: nomEntreprise ?? nomComplet, etape: prepare.etape, contactId, entrepriseId },
    deps,
  );
  if ('simulation' in affaire) return affaire;

  const texte = [
    vide(input.lienLinkedin) ? `Profil LinkedIn : ${vide(input.lienLinkedin)}` : null,
    vide(input.note),
  ]
    .filter(Boolean)
    .join('\n');
  await withInstance(db, instance.id, async (tx) => {
    await tx
      .update(opportunites)
      .set({
        origine: vide(input.origine),
        radarCanalManuel: input.canal,
        radarEtapeManuelle: input.etape ? input.etape : null,
      })
      .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.id, affaire.id)));
    if (texte) {
      await tx.insert(activites).values({
        instanceId: currentInstance,
        type: 'note',
        contactId,
        entrepriseId,
        opportuniteId: affaire.id,
        titre: 'Ajout manuel au Radar',
        at: new Date(),
        resume: texte,
      });
    }
  });
  return { id: affaire.id, contactId };
}
