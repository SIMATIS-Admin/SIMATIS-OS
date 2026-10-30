import { and, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { baseVivante } from '../base-vivante/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { logEvent } from '../journal/service.js';
import { CampagneInvalide, MAX_TACHES_CAMPAGNE, verifierReglage } from './campagnes.js';
import {
  prospectionBrouillons,
  prospectionCampagnes,
  prospectionSuiviFroid,
  type ReglageCampagne,
} from './schema.js';

// Un contact touché doit laisser passer ce délai avant d'être proposé à nouveau.
export const JOURS_ENTRE_TOUCHES = 14;
const LIGNES_MAX = 20_000;

const normaliser = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export type ContactFroid = {
  id: string;
  nom: string;
  entreprise: string;
  fonction: string | null;
  // Numéro de la touche que recevrait ce contact (1 : premier mail).
  touche: number;
};

// Qui peut recevoir un mail à froid : prospectable, joignable, sans opposition ni exclusion, qui n'a
// pas répondu, et soit jamais contacté (nulle part : ni dans l'OS, ni dans le CRM d'un mandat),
// soit en cours de séquence dans l'OS (délai écoulé, plafond de touches non atteint, pas épuisé).
const eligibles = (maintenant: Date) =>
  and(
    eq(baseVivante.instanceId, currentInstance),
    eq(baseVivante.zone, 'prospectable'),
    sql`${baseVivante.email} is not null and ${baseVivante.email} <> ''`,
    eq(baseVivante.emailInvalide, false),
    eq(baseVivante.opposition, false),
    isNull(baseVivante.exclusion),
    ne(baseVivante.statutProspection, 'a_repondu'),
    or(
      and(isNull(prospectionSuiviFroid.id), eq(baseVivante.statutProspection, 'jamais_contacte')),
      and(
        eq(prospectionSuiviFroid.statut, 'actif'),
        sql`${prospectionSuiviFroid.touches} < ${prospectionSuiviFroid.touchesMax}`,
        or(
          isNull(prospectionSuiviFroid.derniereLe),
          lte(
            prospectionSuiviFroid.derniereLe,
            new Date(maintenant.getTime() - JOURS_ENTRE_TOUCHES * 86400_000),
          ),
        ),
      ),
    ),
  );

const colonnes = {
  id: baseVivante.id,
  prenom: baseVivante.prenom,
  nom: baseVivante.nom,
  entreprise: baseVivante.entreprise,
  fonction: baseVivante.fonction,
  email: baseVivante.email,
  domaine: baseVivante.domaine,
  touches: prospectionSuiviFroid.touches,
};
const joindre = (tx: Executor) =>
  tx
    .select(colonnes)
    .from(baseVivante)
    .leftJoin(
      prospectionSuiviFroid,
      and(
        eq(prospectionSuiviFroid.baseId, baseVivante.id),
        eq(prospectionSuiviFroid.instanceId, currentInstance),
      ),
    );

const nomComplet = (c: { prenom: string | null; nom: string }) =>
  [c.prenom, c.nom].filter(Boolean).join(' ').trim();

const melanger = <T>(l: T[]) => {
  const a = [...l];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
};

export async function echantillonFroid(
  tx: Executor,
  { nombre, filtre }: { nombre: number; filtre?: string },
  maintenant = new Date(),
): Promise<ContactFroid[]> {
  const lignes = await joindre(tx).where(eligibles(maintenant)).limit(LIGNES_MAX);
  const f = filtre ? normaliser(filtre.trim()) : '';
  const retenus = f
    ? lignes.filter((c) =>
        normaliser(
          [c.entreprise, c.prenom, c.nom, c.fonction, c.domaine].filter(Boolean).join(' '),
        ).includes(f),
      )
    : lignes;
  return melanger(retenus)
    .slice(0, Math.max(0, nombre))
    .map((c) => ({
      id: c.id,
      nom: nomComplet(c),
      entreprise: c.entreprise,
      fonction: c.fonction,
      touche: (c.touches ?? 0) + 1,
    }));
}

export async function creerCampagneFroid(
  tx: Executor,
  input: { baseIds: string[]; reglage: ReglageCampagne },
  maintenant = new Date(),
): Promise<{ campagneId: string; refusees: { baseId: string; raison: string }[] }> {
  const ids = [...new Set(input.baseIds)];
  if (ids.length === 0) throw new CampagneInvalide('Choisissez au moins un contact.');
  if (ids.length > MAX_TACHES_CAMPAGNE) {
    throw new CampagneInvalide(`Une campagne compte ${MAX_TACHES_CAMPAGNE} contacts au maximum.`);
  }
  await verifierReglage(tx, input.reglage);
  const valides = await joindre(tx).where(and(inArray(baseVivante.id, ids), eligibles(maintenant)));
  const ok = new Set(valides.map((v) => v.id));
  const refusees = ids
    .filter((id) => !ok.has(id))
    .map((baseId) => ({
      baseId,
      raison: "Ce contact n'est plus disponible pour la prospection à froid.",
    }));
  if (valides.length === 0) {
    throw new CampagneInvalide('Aucun contact disponible pour la prospection à froid.');
  }
  const [campagne] = await tx
    .insert(prospectionCampagnes)
    .values({ instanceId: currentInstance, mode: 'froid', reglage: input.reglage })
    .returning({ id: prospectionCampagnes.id });
  if (!campagne) throw new Error('Campagne non créée');
  await tx.insert(prospectionBrouillons).values(
    valides.map((v) => ({
      instanceId: currentInstance,
      campagneId: campagne.id,
      baseId: v.id,
      contactNom: nomComplet(v),
      contactEmail: v.email ?? '',
      societe: v.entreprise,
      touche: (v.touches ?? 0) + 1,
    })),
  );
  return { campagneId: campagne.id, refusees };
}

export type ContactAConfirmer = {
  id: string;
  nom: string;
  entreprise: string;
  touches: number;
  touchesMax: number;
  derniereLe: Date | null;
};

const auPlafond = () =>
  and(
    eq(prospectionSuiviFroid.instanceId, currentInstance),
    eq(prospectionSuiviFroid.statut, 'actif'),
    sql`${prospectionSuiviFroid.touches} >= ${prospectionSuiviFroid.touchesMax}`,
  );

// Contacts qui ont reçu toutes leurs touches sans répondre : Marc décide s'ils sont épuisés.
export async function contactsAConfirmer(tx: Executor): Promise<ContactAConfirmer[]> {
  const rows = await tx
    .select({
      id: baseVivante.id,
      prenom: baseVivante.prenom,
      nom: baseVivante.nom,
      entreprise: baseVivante.entreprise,
      touches: prospectionSuiviFroid.touches,
      touchesMax: prospectionSuiviFroid.touchesMax,
      derniereLe: prospectionSuiviFroid.derniereLe,
    })
    .from(prospectionSuiviFroid)
    .innerJoin(baseVivante, eq(baseVivante.id, prospectionSuiviFroid.baseId))
    .where(and(auPlafond(), ne(baseVivante.statutProspection, 'a_repondu')));
  return rows.map((r) => ({
    id: r.id,
    nom: nomComplet(r),
    entreprise: r.entreprise,
    touches: r.touches,
    touchesMax: r.touchesMax,
    derniereLe: r.derniereLe,
  }));
}

// Jamais automatique : seul un contact au plafond, désigné par Marc, devient épuisé.
export async function confirmerEpuises(tx: Executor, baseIds: string[]): Promise<number> {
  if (baseIds.length === 0) return 0;
  const rows = await tx
    .update(prospectionSuiviFroid)
    .set({ statut: 'epuise', updatedAt: new Date() })
    .where(and(auPlafond(), inArray(prospectionSuiviFroid.baseId, baseIds)))
    .returning({ id: prospectionSuiviFroid.id });
  if (rows.length > 0) {
    await logEvent(tx, {
      acteur: 'pilote',
      action: `${rows.length} contact${rows.length > 1 ? 's' : ''} de prospection marqué${rows.length > 1 ? 's' : ''} épuisé${rows.length > 1 ? 's' : ''}`,
      niveau: 'L2',
    });
  }
  return rows.length;
}

// « Garder » : une touche de plus lui est accordée, il reste dans la séquence.
export async function garderContacts(tx: Executor, baseIds: string[]): Promise<number> {
  if (baseIds.length === 0) return 0;
  const rows = await tx
    .update(prospectionSuiviFroid)
    .set({ touchesMax: sql`${prospectionSuiviFroid.touchesMax} + 1`, updatedAt: new Date() })
    .where(and(auPlafond(), inArray(prospectionSuiviFroid.baseId, baseIds)))
    .returning({ id: prospectionSuiviFroid.id });
  return rows.length;
}

// Pour l'accueil : combien de contacts peuvent recevoir un premier mail, combien une touche de plus.
export async function compterFroid(
  tx: Executor,
  maintenant = new Date(),
): Promise<{ disponibles: number; aRelancer: number }> {
  const lignes = await joindre(tx).where(eligibles(maintenant)).limit(LIGNES_MAX);
  const aRelancer = lignes.filter((c) => (c.touches ?? 0) > 0).length;
  return { disponibles: lignes.length - aRelancer, aRelancer };
}
