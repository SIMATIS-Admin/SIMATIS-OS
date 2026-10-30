import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { contacts, entreprises, taches } from '../crm/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { jourDe } from '../pilotage/realisees.js';
import {
  OFFRES,
  prospectionBrouillons,
  prospectionCampagnes,
  prospectionOccurrences,
  prospectionSignatures,
  type Brouillon,
  type Campagne,
  type ReglageCampagne,
} from './schema.js';

export class CampagneInvalide extends Error {}

export const MAX_TACHES_CAMPAGNE = 60;
export const TOUCHES_MAX_DEFAUT = 4;

export const reglageParDefaut = (): ReglageCampagne => ({
  offre: 'vma',
  creneaux: true,
  signatureId: null,
  suivi: { type: 'courte' },
  touchesMax: TOUCHES_MAX_DEFAUT,
});

export type BrouillonVue = Omit<Brouillon, 'instanceId' | 'source' | 'sourceId'>;
export type CampagneVue = Omit<Campagne, 'instanceId' | 'source' | 'sourceId'> & {
  brouillons: BrouillonVue[];
};

async function verifierReglage(tx: Executor, r: ReglageCampagne) {
  if (!(OFFRES as readonly string[]).includes(r.offre)) {
    throw new CampagneInvalide('Offre inconnue.');
  }
  if (!Number.isInteger(r.touchesMax) || r.touchesMax < 1 || r.touchesMax > 10) {
    throw new CampagneInvalide('Le nombre maximum de touches doit être de 1 à 10.');
  }
  if (!['courte', 'longue', 'date'].includes(r.suivi.type)) {
    throw new CampagneInvalide('Délai de suivi inconnu.');
  }
  if (r.suivi.type === 'date') {
    const date = r.suivi.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new CampagneInvalide('Indiquez la date du suivi.');
    }
    if (date < jourDe(new Date())) {
      throw new CampagneInvalide('La date du suivi doit être aujourd’hui ou plus tard.');
    }
  }
  if (r.signatureId) {
    const [s] = await tx
      .select({ id: prospectionSignatures.id })
      .from(prospectionSignatures)
      .where(
        and(
          eq(prospectionSignatures.instanceId, currentInstance),
          eq(prospectionSignatures.id, r.signatureId),
        ),
      );
    if (!s) throw new CampagneInvalide('Signature introuvable dans cette instance.');
  }
}

const REFUS = {
  introuvable: 'Tâche introuvable dans cette instance.',
  faite: 'Tâche déjà faite.',
  canal: 'Ce n’est pas une tâche de mail.',
  contact: 'Aucun contact lié à cette tâche.',
  email: 'Le contact n’a pas d’adresse mail.',
};

// Relance de tâches : un brouillon à rédiger par tâche de mail ouverte dont le contact a une adresse.
// Les tâches refusées sont rendues avec leur raison ; si aucune n'est valide, rien n'est créé.
export async function creerCampagneRelance(
  tx: Executor,
  input: { tacheIds: string[]; reglage: ReglageCampagne },
): Promise<{ campagneId: string; refusees: { tacheId: string; raison: string }[] }> {
  const ids = [...new Set(input.tacheIds)];
  if (ids.length === 0) throw new CampagneInvalide('Choisissez au moins une tâche.');
  if (ids.length > MAX_TACHES_CAMPAGNE) {
    throw new CampagneInvalide(`Une campagne compte ${MAX_TACHES_CAMPAGNE} tâches au maximum.`);
  }
  await verifierReglage(tx, input.reglage);

  const rows = await tx
    .select({
      id: taches.id,
      canal: taches.canal,
      faitAt: taches.faitAt,
      contactId: contacts.id,
      contactNom: contacts.nom,
      contactEmail: contacts.email,
      societeContact: entreprises.nom,
    })
    .from(taches)
    .leftJoin(
      contacts,
      and(eq(contacts.id, taches.contactId), eq(contacts.instanceId, currentInstance)),
    )
    .leftJoin(
      entreprises,
      and(eq(entreprises.id, contacts.entrepriseId), eq(entreprises.instanceId, currentInstance)),
    )
    .where(and(eq(taches.instanceId, currentInstance), inArray(taches.id, ids)));
  const parId = new Map(rows.map((r) => [r.id, r]));

  const refusees: { tacheId: string; raison: string }[] = [];
  const valides: {
    tacheId: string;
    contactId: string;
    nom: string;
    email: string;
    societe: string | null;
  }[] = [];
  for (const id of ids) {
    const r = parId.get(id);
    const raison = !r
      ? REFUS.introuvable
      : r.faitAt
        ? REFUS.faite
        : r.canal !== 'email'
          ? REFUS.canal
          : !r.contactId
            ? REFUS.contact
            : !r.contactEmail
              ? REFUS.email
              : null;
    if (raison || !r?.contactId || !r.contactEmail)
      refusees.push({ tacheId: id, raison: raison ?? REFUS.contact });
    else {
      valides.push({
        tacheId: id,
        contactId: r.contactId,
        nom: r.contactNom ?? '',
        email: r.contactEmail,
        societe: r.societeContact,
      });
    }
  }
  if (valides.length === 0) {
    throw new CampagneInvalide(
      `Aucune tâche utilisable : ${[...new Set(refusees.map((x) => x.raison))].join(' ')}`,
    );
  }

  // Le premier contact a eu lieu hors de l'OS : la première relance est la touche 2.
  const dejaEnvoyes = await tx
    .select({ contactId: prospectionOccurrences.contactId })
    .from(prospectionOccurrences)
    .where(
      and(
        eq(prospectionOccurrences.instanceId, currentInstance),
        ne(prospectionOccurrences.etat, 'brouillon'),
        inArray(
          prospectionOccurrences.contactId,
          valides.map((v) => v.contactId),
        ),
      ),
    );
  const nbEnvoyes = new Map<string, number>();
  for (const o of dejaEnvoyes) {
    if (o.contactId) nbEnvoyes.set(o.contactId, (nbEnvoyes.get(o.contactId) ?? 0) + 1);
  }

  const [campagne] = await tx
    .insert(prospectionCampagnes)
    .values({ instanceId: currentInstance, mode: 'relance', reglage: input.reglage })
    .returning({ id: prospectionCampagnes.id });
  if (!campagne) throw new Error('Campagne non créée');
  await tx.insert(prospectionBrouillons).values(
    valides.map((v) => ({
      instanceId: currentInstance,
      campagneId: campagne.id,
      tacheId: v.tacheId,
      contactId: v.contactId,
      contactNom: v.nom,
      contactEmail: v.email,
      societe: v.societe,
      touche: 2 + (nbEnvoyes.get(v.contactId) ?? 0),
    })),
  );
  return { campagneId: campagne.id, refusees };
}

// Colonnes techniques d'instance et de source : l'écran n'en a pas besoin.
const sansInstance = <T extends { instanceId: string; source: string; sourceId: string | null }>(
  row: T,
): Omit<T, 'instanceId' | 'source' | 'sourceId'> =>
  Object.fromEntries(
    Object.entries(row).filter(([k]) => !['instanceId', 'source', 'sourceId'].includes(k)),
  ) as Omit<T, 'instanceId' | 'source' | 'sourceId'>;

export async function lireCampagne(tx: Executor, id: string): Promise<CampagneVue> {
  const [c] = await tx
    .select()
    .from(prospectionCampagnes)
    .where(
      and(eq(prospectionCampagnes.instanceId, currentInstance), eq(prospectionCampagnes.id, id)),
    );
  if (!c) throw new CampagneInvalide('Campagne introuvable.');
  const brouillons = await tx
    .select()
    .from(prospectionBrouillons)
    .where(
      and(
        eq(prospectionBrouillons.instanceId, currentInstance),
        eq(prospectionBrouillons.campagneId, id),
      ),
    )
    .orderBy(asc(prospectionBrouillons.createdAt), asc(prospectionBrouillons.contactNom));
  return { ...sansInstance(c), brouillons: brouillons.map(sansInstance) };
}
