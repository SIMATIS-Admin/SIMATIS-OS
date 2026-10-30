import { and, eq, ne } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { logEvent } from '../journal/service.js';
import { OBJECTIF_MAX, prospectionReglages, prospectionSignatures } from './schema.js';

export class SignatureInvalide extends Error {}
export class SignatureIntrouvable extends SignatureInvalide {}

export const TAILLE_MAX_SIGNATURE = 400 * 1024;
const NOM_MAX = 60;
const TYPES_IMAGE = ['image/png', 'image/jpeg'] as const;

export type SignatureVue = { id: string; nom: string; defaut: boolean; typeMime: string };
export type ImageEntrante = { typeMime: string; imageBase64: string };

const OCTETS_MAGIQUES: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

// Le type annoncé ne suffit pas : les premiers octets doivent être ceux d'un PNG ou d'un JPEG.
function decoder({ typeMime, imageBase64 }: ImageEntrante): Buffer {
  if (!(TYPES_IMAGE as readonly string[]).includes(typeMime)) {
    throw new SignatureInvalide('Image refusée : seuls le PNG et le JPEG sont acceptés.');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
    throw new SignatureInvalide("Image illisible : le fichier n'a pas pu être lu.");
  }
  const octets = Buffer.from(imageBase64, 'base64');
  if (octets.length > TAILLE_MAX_SIGNATURE) {
    throw new SignatureInvalide('Image trop lourde : 400 Ko au maximum.');
  }
  const magiques = OCTETS_MAGIQUES[typeMime] ?? [];
  if (magiques.some((o, i) => octets[i] !== o)) {
    throw new SignatureInvalide(
      `Ce fichier n'est pas une image ${typeMime === 'image/png' ? 'PNG' : 'JPEG'}.`,
    );
  }
  return octets;
}

function nomValide(nom: string): string {
  const n = nom.trim();
  if (!n) throw new SignatureInvalide('Donnez un nom à la signature.');
  if (n.length > NOM_MAX)
    throw new SignatureInvalide(`Nom trop long : ${NOM_MAX} caractères au maximum.`);
  return n;
}

const colonnesVue = {
  id: prospectionSignatures.id,
  nom: prospectionSignatures.nom,
  defaut: prospectionSignatures.defaut,
  typeMime: prospectionSignatures.typeMime,
};
const decrite = (id: string) =>
  and(eq(prospectionSignatures.instanceId, currentInstance), eq(prospectionSignatures.id, id));

async function exiger(tx: Executor, id: string): Promise<SignatureVue> {
  const [s] = await tx.select(colonnesVue).from(prospectionSignatures).where(decrite(id));
  if (!s) throw new SignatureIntrouvable('Signature introuvable.');
  return s;
}

async function nomLibre(tx: Executor, nom: string, sauf?: string) {
  const [pris] = await tx
    .select({ id: prospectionSignatures.id })
    .from(prospectionSignatures)
    .where(
      and(
        eq(prospectionSignatures.instanceId, currentInstance),
        eq(prospectionSignatures.nom, nom),
        sauf ? ne(prospectionSignatures.id, sauf) : undefined,
      ),
    );
  if (pris) throw new SignatureInvalide(`Une signature s'appelle déjà « ${nom} ».`);
}

export async function listerSignatures(tx: Executor): Promise<SignatureVue[]> {
  return tx
    .select(colonnesVue)
    .from(prospectionSignatures)
    .where(eq(prospectionSignatures.instanceId, currentInstance))
    .orderBy(prospectionSignatures.nom);
}

export async function ajouterSignature(
  tx: Executor,
  entree: ImageEntrante & { nom: string },
): Promise<SignatureVue> {
  const nom = nomValide(entree.nom);
  decoder(entree);
  await nomLibre(tx, nom);
  const [s] = await tx
    .insert(prospectionSignatures)
    .values({
      instanceId: currentInstance,
      nom,
      typeMime: entree.typeMime,
      image: entree.imageBase64,
    })
    .returning(colonnesVue);
  await logEvent(tx, { acteur: 'pilote', action: `Signature ajoutée : ${nom}`, niveau: 'L2' });
  return s as SignatureVue;
}

export async function renommerSignature(tx: Executor, id: string, nouveauNom: string) {
  const nom = nomValide(nouveauNom);
  await exiger(tx, id);
  await nomLibre(tx, nom, id);
  await tx.update(prospectionSignatures).set({ nom, updatedAt: new Date() }).where(decrite(id));
  await logEvent(tx, { acteur: 'pilote', action: `Signature renommée : ${nom}`, niveau: 'L2' });
}

export async function remplacerImage(tx: Executor, id: string, image: ImageEntrante) {
  decoder(image);
  const s = await exiger(tx, id);
  await tx
    .update(prospectionSignatures)
    .set({ typeMime: image.typeMime, image: image.imageBase64, updatedAt: new Date() })
    .where(decrite(id));
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Image de la signature remplacée : ${s.nom}`,
    niveau: 'L2',
  });
}

export async function supprimerSignature(tx: Executor, id: string) {
  const s = await exiger(tx, id);
  await tx.delete(prospectionSignatures).where(decrite(id));
  await logEvent(tx, { acteur: 'pilote', action: `Signature supprimée : ${s.nom}`, niveau: 'L2' });
}

// `null` : plus aucune signature par défaut (les mails partent sans signature).
export async function definirDefaut(tx: Executor, id: string | null) {
  if (id) await exiger(tx, id);
  await tx
    .update(prospectionSignatures)
    .set({ defaut: false })
    .where(eq(prospectionSignatures.instanceId, currentInstance));
  if (id) await tx.update(prospectionSignatures).set({ defaut: true }).where(decrite(id));
  await logEvent(tx, {
    acteur: 'pilote',
    action: id ? 'Signature par défaut changée' : 'Plus de signature par défaut',
    niveau: 'L2',
  });
}

export async function imageSignature(
  tx: Executor,
  id: string,
): Promise<{ typeMime: string; octets: Buffer } | null> {
  const [s] = await tx
    .select({ typeMime: prospectionSignatures.typeMime, image: prospectionSignatures.image })
    .from(prospectionSignatures)
    .where(decrite(id));
  return s ? { typeMime: s.typeMime, octets: Buffer.from(s.image, 'base64') } : null;
}

export async function reglerObjectif(tx: Executor, objectif: number) {
  if (!Number.isInteger(objectif) || objectif < 0 || objectif > OBJECTIF_MAX) {
    throw new SignatureInvalide(`L'objectif doit être un nombre entier de 0 à ${OBJECTIF_MAX}.`);
  }
  await tx
    .insert(prospectionReglages)
    .values({ instanceId: currentInstance, objectifJour: objectif })
    .onConflictDoUpdate({
      target: prospectionReglages.instanceId,
      set: { objectifJour: objectif, updatedAt: new Date() },
    });
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Objectif quotidien de prospection réglé : ${objectif}`,
    niveau: 'L2',
  });
}
