import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { logEvent } from '../journal/service.js';
import {
  ETAPES_SALESNAV,
  salesnavCampagnes,
  salesnavModeles,
  type EtapeSalesnav,
} from './schema.js';

export class ModeleInvalide extends Error {}
export class CampagneIntrouvable extends ModeleInvalide {}

// Longueur maximale de la note d'une demande de connexion dans Sales Navigator.
export const LIMITE_INVITATION = 300;
const TEXTE_MAX = 5000;
const NOM_MAX = 80;
const ICP_MAX = 60;

export type ModeleVue = { icp: string; etape: EtapeSalesnav; texte: string };
export type CampagneVue = {
  id: string;
  nom: string;
  icp: string;
  surcharges: { etape: EtapeSalesnav; texte: string }[];
};

function etapeValide(etape: string): EtapeSalesnav {
  if (!(ETAPES_SALESNAV as readonly string[]).includes(etape))
    throw new ModeleInvalide('Étape inconnue.');
  return etape as EtapeSalesnav;
}

function icpValide(icp: string): string {
  const c = icp.trim();
  if (!c) throw new ModeleInvalide('Indiquez la cible du message.');
  if (c.length > ICP_MAX) throw new ModeleInvalide(`Cible trop longue : ${ICP_MAX} caractères.`);
  return c;
}

// Le texte garde ses retours à la ligne ; la note d'invitation ne dépasse pas la limite de LinkedIn.
function texteValide(etape: EtapeSalesnav, texte: string): string {
  const t = texte.trim();
  if (!t) throw new ModeleInvalide('Le message est vide.');
  if (t.length > TEXTE_MAX)
    throw new ModeleInvalide(`Message trop long : ${TEXTE_MAX} caractères au maximum.`);
  if (etape === 'invitation' && t.length > LIMITE_INVITATION)
    throw new ModeleInvalide(
      `Note d'invitation trop longue : ${LIMITE_INVITATION} caractères au maximum (${t.length}).`,
    );
  return t;
}

export async function listerModeles(tx: Executor): Promise<ModeleVue[]> {
  const lignes = await tx
    .select({
      icp: salesnavModeles.icp,
      etape: salesnavModeles.etape,
      texte: salesnavModeles.texte,
    })
    .from(salesnavModeles)
    .where(and(eq(salesnavModeles.instanceId, currentInstance), isNull(salesnavModeles.campagneId)))
    .orderBy(asc(salesnavModeles.icp));
  return lignes.sort(
    (x, y) =>
      x.icp.localeCompare(y.icp) ||
      ETAPES_SALESNAV.indexOf(x.etape) - ETAPES_SALESNAV.indexOf(y.etape),
  );
}

export async function sauverModele(
  tx: Executor,
  icpBrut: string,
  etapeBrute: string,
  texteBrut: string,
): Promise<void> {
  const icp = icpValide(icpBrut);
  const etape = etapeValide(etapeBrute);
  const texte = texteValide(etape, texteBrut);
  const [existant] = await tx
    .select({ id: salesnavModeles.id })
    .from(salesnavModeles)
    .where(
      and(
        eq(salesnavModeles.instanceId, currentInstance),
        eq(salesnavModeles.icp, icp),
        eq(salesnavModeles.etape, etape),
        isNull(salesnavModeles.campagneId),
      ),
    );
  if (existant) {
    await tx
      .update(salesnavModeles)
      .set({ texte, updatedAt: new Date() })
      .where(eq(salesnavModeles.id, existant.id));
  } else {
    await tx.insert(salesnavModeles).values({ instanceId: currentInstance, icp, etape, texte });
  }
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Modèle Sales Navigator enregistré : ${icp}, ${etape}`,
    niveau: 'L2',
  });
}

const dansInstance = (id: string) =>
  and(eq(salesnavCampagnes.instanceId, currentInstance), eq(salesnavCampagnes.id, id));

async function exigerCampagne(tx: Executor, id: string) {
  const [c] = await tx.select().from(salesnavCampagnes).where(dansInstance(id));
  if (!c) throw new CampagneIntrouvable('Campagne introuvable.');
  return c;
}

export async function creerCampagne(
  tx: Executor,
  entree: { nom: string; icp: string },
): Promise<{ id: string; nom: string; icp: string }> {
  const nom = entree.nom.trim();
  if (!nom) throw new ModeleInvalide('Donnez un nom à la campagne.');
  if (nom.length > NOM_MAX) throw new ModeleInvalide(`Nom trop long : ${NOM_MAX} caractères.`);
  const icp = icpValide(entree.icp);
  const [pris] = await tx
    .select({ id: salesnavCampagnes.id })
    .from(salesnavCampagnes)
    .where(and(eq(salesnavCampagnes.instanceId, currentInstance), eq(salesnavCampagnes.nom, nom)));
  if (pris) throw new ModeleInvalide(`Une campagne s'appelle déjà « ${nom} ».`);
  const [c] = await tx
    .insert(salesnavCampagnes)
    .values({ instanceId: currentInstance, nom, icp })
    .returning({
      id: salesnavCampagnes.id,
      nom: salesnavCampagnes.nom,
      icp: salesnavCampagnes.icp,
    });
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Campagne Sales Navigator créée : ${nom}`,
    niveau: 'L2',
  });
  return c!;
}

export async function supprimerCampagne(tx: Executor, id: string): Promise<void> {
  const c = await exigerCampagne(tx, id);
  await tx.delete(salesnavCampagnes).where(dansInstance(id));
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Campagne Sales Navigator supprimée : ${c.nom}`,
    niveau: 'L2',
  });
}

export async function listerCampagnes(tx: Executor): Promise<CampagneVue[]> {
  const campagnes = await tx
    .select({ id: salesnavCampagnes.id, nom: salesnavCampagnes.nom, icp: salesnavCampagnes.icp })
    .from(salesnavCampagnes)
    .where(eq(salesnavCampagnes.instanceId, currentInstance))
    .orderBy(asc(salesnavCampagnes.nom));
  const surcharges = await tx
    .select({
      campagneId: salesnavModeles.campagneId,
      etape: salesnavModeles.etape,
      texte: salesnavModeles.texte,
    })
    .from(salesnavModeles)
    .where(eq(salesnavModeles.instanceId, currentInstance));
  return campagnes.map((c) => ({
    ...c,
    surcharges: surcharges
      .filter((s) => s.campagneId === c.id)
      .map(({ etape, texte }) => ({ etape, texte }))
      .sort((x, y) => ETAPES_SALESNAV.indexOf(x.etape) - ETAPES_SALESNAV.indexOf(y.etape)),
  }));
}

export async function sauverSurcharge(
  tx: Executor,
  campagneId: string,
  etapeBrute: string,
  texteBrut: string,
): Promise<void> {
  const c = await exigerCampagne(tx, campagneId);
  const etape = etapeValide(etapeBrute);
  const texte = texteValide(etape, texteBrut);
  const [existant] = await tx
    .select({ id: salesnavModeles.id })
    .from(salesnavModeles)
    .where(and(eq(salesnavModeles.campagneId, campagneId), eq(salesnavModeles.etape, etape)));
  if (existant) {
    await tx
      .update(salesnavModeles)
      .set({ texte, updatedAt: new Date() })
      .where(eq(salesnavModeles.id, existant.id));
  } else {
    await tx
      .insert(salesnavModeles)
      .values({ instanceId: currentInstance, icp: c.icp, etape, campagneId, texte });
  }
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Message de campagne modifié : ${c.nom}, ${etape}`,
    niveau: 'L2',
  });
}

export async function retirerSurcharge(
  tx: Executor,
  campagneId: string,
  etapeBrute: string,
): Promise<void> {
  const c = await exigerCampagne(tx, campagneId);
  const etape = etapeValide(etapeBrute);
  await tx
    .delete(salesnavModeles)
    .where(and(eq(salesnavModeles.campagneId, campagneId), eq(salesnavModeles.etape, etape)));
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Message de campagne remis au modèle : ${c.nom}, ${etape}`,
    niveau: 'L2',
  });
}

// Le message à envoyer pour une campagne et une étape : le texte propre à la campagne s'il existe,
// sinon le modèle par défaut de la cible.
export async function messageEffectif(
  tx: Executor,
  campagneId: string,
  etapeBrute: string,
): Promise<{ texte: string; origine: 'campagne' | 'defaut' }> {
  const c = await exigerCampagne(tx, campagneId);
  const etape = etapeValide(etapeBrute);
  const [propre] = await tx
    .select({ texte: salesnavModeles.texte })
    .from(salesnavModeles)
    .where(and(eq(salesnavModeles.campagneId, campagneId), eq(salesnavModeles.etape, etape)));
  if (propre) return { texte: propre.texte, origine: 'campagne' };
  const [defaut] = await tx
    .select({ texte: salesnavModeles.texte })
    .from(salesnavModeles)
    .where(
      and(
        eq(salesnavModeles.instanceId, currentInstance),
        eq(salesnavModeles.icp, c.icp),
        eq(salesnavModeles.etape, etape),
        isNull(salesnavModeles.campagneId),
      ),
    );
  if (!defaut) throw new ModeleInvalide(`Aucun modèle pour « ${c.icp} », étape ${etape}.`);
  return { texte: defaut.texte, origine: 'defaut' };
}

export type Variables = { prenom?: string; entreprise?: string };

// Remplace {prénom} et {entreprise} ; une variable sans valeur reste visible et est signalée,
// pour qu'un message ne parte jamais avec un trou.
export function rendre(
  texte: string,
  valeurs: Variables,
): { texte: string; manquantes: string[]; longueur: number } {
  const manquantes: string[] = [];
  const remplace = (nom: 'prenom' | 'entreprise', marque: string) => (t: string) => {
    if (!t.includes(marque)) return t;
    const valeur = valeurs[nom]?.trim();
    if (!valeur) {
      manquantes.push(nom);
      return t;
    }
    return t.split(marque).join(valeur);
  };
  const rendu = [remplace('prenom', '{prénom}'), remplace('entreprise', '{entreprise}')].reduce(
    (t, f) => f(t),
    texte,
  );
  return { texte: rendu, manquantes, longueur: rendu.length };
}
