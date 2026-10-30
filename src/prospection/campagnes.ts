import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
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
export class CampagneIntrouvable extends CampagneInvalide {}

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

export async function verifierReglage(tx: Executor, r: ReglageCampagne) {
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
  // `liens` : contact choisi par Marc pour une tâche que HubSpot ne relie à personne (tâche => contact).
  input: { tacheIds: string[]; reglage: ReglageCampagne; liens?: Record<string, string> },
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

  // Un contact choisi à la main remplace celui de la tâche ; il doit exister dans l'instance, avec une adresse.
  const choix = new Map<
    string,
    { id: string; nom: string; email: string; societe: string | null }
  >();
  const choisis = [
    ...new Set(
      Object.entries(input.liens ?? {})
        .filter(([t]) => ids.includes(t))
        .map(([, c]) => c),
    ),
  ];
  if (choisis.length > 0) {
    const trouves = await tx
      .select({
        id: contacts.id,
        nom: contacts.nom,
        email: contacts.email,
        societe: entreprises.nom,
      })
      .from(contacts)
      .leftJoin(
        entreprises,
        and(eq(entreprises.id, contacts.entrepriseId), eq(entreprises.instanceId, currentInstance)),
      )
      .where(and(eq(contacts.instanceId, currentInstance), inArray(contacts.id, choisis)));
    const parContact = new Map(trouves.map((c) => [c.id, c]));
    for (const [tacheId, contactId] of Object.entries(input.liens ?? {})) {
      if (!ids.includes(tacheId)) continue;
      const c = parContact.get(contactId);
      if (!c) throw new CampagneInvalide('Le contact choisi est introuvable dans cette instance.');
      if (!c.email)
        throw new CampagneInvalide(
          `${c.nom} n'a pas d'adresse mail : choisissez un autre contact.`,
        );
      choix.set(tacheId, { id: c.id, nom: c.nom, email: c.email, societe: c.societe });
    }
  }

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
    const lie = choix.get(id);
    if (lie && r && !r.faitAt && r.canal === 'email') {
      valides.push({
        tacheId: id,
        contactId: lie.id,
        nom: lie.nom,
        email: lie.email,
        societe: lie.societe,
      });
      continue;
    }
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
  if (!c) throw new CampagneIntrouvable('Campagne introuvable.');
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

export type TacheRelanceVue = {
  id: string;
  titre: string;
  contactNom: string | null;
  societe: string | null;
  echeance: Date | null;
  touche: number;
  // Faux : la tâche n'a pas de contact ou le contact n'a pas d'adresse, elle ne peut pas être choisie.
  utilisable: boolean;
  // Tâche inutilisable dont le titre nomme un seul contact de l'instance ayant une adresse.
  suggestion: { contactId: string; contactNom: string; societe: string | null } | null;
};

const normaliser = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

// Tâches de mail ouvertes, échues ou à échéance dans les deux jours : ce que Marc peut relancer.
export async function tachesRelance(
  tx: Executor,
  maintenant = new Date(),
): Promise<TacheRelanceVue[]> {
  const rows = await tx
    .select({
      id: taches.id,
      titre: taches.titre,
      echeance: taches.echeance,
      contactId: contacts.id,
      contactNom: contacts.nom,
      contactEmail: contacts.email,
      societe: entreprises.nom,
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
    .where(
      and(
        eq(taches.instanceId, currentInstance),
        eq(taches.canal, 'email'),
        isNull(taches.faitAt),
        lt(taches.echeance, new Date(maintenant.getTime() + 2 * 86400_000)),
      ),
    )
    .orderBy(asc(taches.echeance))
    .limit(300);
  const ids = rows.flatMap((r) => (r.contactId ? [r.contactId] : []));
  const envoyes = ids.length
    ? await tx
        .select({ contactId: prospectionOccurrences.contactId })
        .from(prospectionOccurrences)
        .where(
          and(
            eq(prospectionOccurrences.instanceId, currentInstance),
            ne(prospectionOccurrences.etat, 'brouillon'),
            inArray(prospectionOccurrences.contactId, ids),
          ),
        )
    : [];
  const nb = new Map<string, number>();
  for (const o of envoyes) if (o.contactId) nb.set(o.contactId, (nb.get(o.contactId) ?? 0) + 1);
  const inutilisables = rows.filter((r) => !r.contactId || !r.contactEmail);
  const candidats =
    inutilisables.length > 0
      ? (
          await tx
            .select({ id: contacts.id, nom: contacts.nom, societe: entreprises.nom })
            .from(contacts)
            .leftJoin(
              entreprises,
              and(
                eq(entreprises.id, contacts.entrepriseId),
                eq(entreprises.instanceId, currentInstance),
              ),
            )
            .where(and(eq(contacts.instanceId, currentInstance), isNotNull(contacts.email)))
        ).filter((c) => normaliser(c.nom).length >= 5)
      : [];
  const suggestion = (titre: string) => {
    const t = normaliser(titre);
    const trouves = candidats.filter((c) => t.includes(normaliser(c.nom)));
    const un = trouves.length === 1 ? trouves[0] : undefined;
    return un ? { contactId: un.id, contactNom: un.nom, societe: un.societe } : null;
  };
  return rows.map((r) => {
    const utilisable = !!r.contactId && !!r.contactEmail;
    return {
      id: r.id,
      titre: r.titre,
      contactNom: r.contactNom,
      societe: r.societe,
      echeance: r.echeance,
      touche: 2 + (r.contactId ? (nb.get(r.contactId) ?? 0) : 0),
      utilisable,
      suggestion: utilisable ? null : suggestion(r.titre),
    };
  });
}

export type CampagneResume = {
  id: string;
  mode: Campagne['mode'];
  statut: Campagne['statut'];
  creeLe: Date;
  brouillons: number;
  resultat: Campagne['resultat'];
};

// Les dernières campagnes, pour l'accueil, et celle qu'il faut rouvrir (rédaction, relecture, erreur).
export async function campagnesRecentes(
  tx: Executor,
  limite = 5,
): Promise<{ recentes: CampagneResume[]; enCours: string | null }> {
  const rows = await tx
    .select()
    .from(prospectionCampagnes)
    .where(eq(prospectionCampagnes.instanceId, currentInstance))
    .orderBy(desc(prospectionCampagnes.createdAt))
    .limit(Math.max(limite, 20));
  const ids = rows.map((r) => r.id);
  const bs = ids.length
    ? await tx
        .select({ campagneId: prospectionBrouillons.campagneId })
        .from(prospectionBrouillons)
        .where(
          and(
            eq(prospectionBrouillons.instanceId, currentInstance),
            inArray(prospectionBrouillons.campagneId, ids),
            ne(prospectionBrouillons.etat, 'ecarte'),
          ),
        )
    : [];
  const resume = rows.map((r) => ({
    id: r.id,
    mode: r.mode,
    statut: r.statut,
    creeLe: r.createdAt,
    brouillons: bs.filter((b) => b.campagneId === r.id).length,
    resultat: r.resultat,
  }));
  return {
    recentes: resume.filter((r) => r.statut === 'terminee').slice(0, limite),
    enCours: resume.find((r) => r.statut !== 'terminee')?.id ?? null,
  };
}
