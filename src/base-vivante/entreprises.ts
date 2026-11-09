import { and, eq } from 'drizzle-orm';
import {
  ErreurAnnuaire,
  type ClientAnnuaire,
  type EntrepriseAnnuaire,
} from '../annuaire/client.js';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import { FicheIntrouvable, rattacherEntreprise } from './integration.js';
import { baseEntreprises, baseVivante, type EntrepriseBase } from './schema.js';

export class EntrepriseIntrouvable extends Error {}
export class SirenInvalide extends ErreurAnnuaire {}

// One company per SIREN and per instance: a second link refreshes what the directory says.
// The website, found elsewhere, is never overwritten by a refresh.
export async function enregistrerEntreprise(
  tx: Tx,
  instanceId: string,
  e: EntrepriseAnnuaire,
): Promise<EntrepriseBase> {
  const valeurs = {
    nom: e.nom,
    formeJuridique: e.formeJuridique,
    naf: e.naf,
    categorie: e.categorie,
    effectif: e.effectif,
    creeLe: e.creeLe,
    active: e.active,
    etablissementsOuverts: e.etablissementsOuverts,
    oppositionDiffusion: e.oppositionDiffusion,
    siret: e.siret,
    adresse: e.adresse,
    codePostal: e.codePostal,
    ville: e.ville,
    departement: e.departement,
    latitude: e.latitude,
    longitude: e.longitude,
    finances: e.finances,
    dirigeants: e.dirigeants,
    annuaireLe: new Date(),
    updatedAt: new Date(),
  };
  const [ligne] = await tx
    .insert(baseEntreprises)
    .values({ instanceId, siren: e.siren, ...valeurs })
    .onConflictDoUpdate({
      target: [baseEntreprises.instanceId, baseEntreprises.siren],
      set: valeurs,
    })
    .returning();
  if (!ligne) throw new Error('Entreprise non enregistrée');
  return ligne;
}

export async function lireEntreprise(
  db: Executor,
  instanceId: string,
  id: string,
): Promise<EntrepriseBase> {
  const [e] = await withInstance(db, instanceId, (tx) =>
    tx
      .select()
      .from(baseEntreprises)
      .where(and(eq(baseEntreprises.id, id), eq(baseEntreprises.instanceId, instanceId))),
  );
  if (!e) throw new EntrepriseIntrouvable('Entreprise introuvable');
  return e;
}

async function nomDeLaFiche(db: Executor, instanceId: string, id: string): Promise<string> {
  const [f] = await withInstance(db, instanceId, (tx) =>
    tx
      .select({ entreprise: baseVivante.entreprise })
      .from(baseVivante)
      .where(and(eq(baseVivante.id, id), eq(baseVivante.instanceId, instanceId))),
  );
  if (!f) throw new FicheIntrouvable('Fiche introuvable');
  return f.entreprise;
}

// Some lists write the place after the name (« Atelier — Dijon / Longvic (21) »): the directory
// knows the company by its name alone, and the number is the département to narrow the search.
export function nomRecherche(entreprise: string): { nom: string; departement: string | null } {
  const m = /^(.+?)\s+[—–-]\s+.+\((\d{2,3}|2[AB])\)\s*$/.exec(entreprise.trim());
  return m?.[1]
    ? { nom: m[1].trim(), departement: m[2] ?? null }
    : { nom: entreprise.trim(), departement: null };
}

// Nothing is linked on its own: the directory only proposes, the pilot picks.
export async function candidatsPourFiche(
  db: Executor,
  annuaire: ClientAnnuaire,
  instanceId: string,
  ficheId: string,
): Promise<EntrepriseAnnuaire[]> {
  const { nom, departement } = nomRecherche(await nomDeLaFiche(db, instanceId, ficheId));
  return annuaire.chercher(nom, { limite: 5, ...(departement ? { departement } : {}) });
}

export async function rattacherParSiren(
  db: Executor,
  annuaire: ClientAnnuaire,
  instanceId: string,
  ficheId: string,
  siren: string,
): Promise<{ entreprise: EntrepriseBase; rattachees: number }> {
  const chiffres = siren.replace(/\s/g, '');
  if (!/^\d{9}$/.test(chiffres)) throw new SirenInvalide('SIREN invalide : 9 chiffres attendus.');
  await nomDeLaFiche(db, instanceId, ficheId);
  const trouvee = await annuaire.parSiren(chiffres);
  if (!trouvee) throw new EntrepriseIntrouvable('Aucune entreprise avec ce SIREN dans l’annuaire.');
  return withInstance(db, instanceId, async (tx) => {
    const entreprise = await enregistrerEntreprise(tx, instanceId, trouvee);
    return {
      entreprise,
      rattachees: await rattacherEntreprise(tx, instanceId, ficheId, entreprise.id),
    };
  });
}
