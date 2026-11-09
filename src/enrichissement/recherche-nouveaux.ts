import { eq } from 'drizzle-orm';
import { clesDoublon, normaliserFiche } from '../base-vivante/nettoyage.js';
import { baseVivante } from '../base-vivante/schema.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import type { ClientIA } from './client.js';
import { chercherProspects } from './recherche.js';

export type ProspectRecherche = Awaited<ReturnType<typeof chercherProspects>>[number];
type IdentiteProspect = Pick<
  ProspectRecherche,
  'entreprise' | 'prenom' | 'nom' | 'fonction' | 'email' | 'linkedin'
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clesDuProspect = (contact: IdentiteProspect) =>
  clesDoublon(
    normaliserFiche({
      entreprise: contact.entreprise,
      prenom: contact.prenom,
      nom: contact.nom,
      fonction: contact.fonction,
      email: contact.email,
      linkedin: contact.linkedin,
    }).fiche,
  );

const identite = (contact: ProspectRecherche) =>
  `${contact.prenom} ${contact.nom} (${contact.entreprise})`;

async function clesDeLaBase(db: Database, instanceId: string) {
  // Les anciens tests de tâche emploient des identifiants symboliques, alors que les instances
  // réelles ont toujours un UUID.
  if (!UUID.test(instanceId)) return new Set<string>();
  const lignes = await withInstance(db, instanceId, (tx) =>
    tx
      .select({
        cles: baseVivante.cles,
        entreprise: baseVivante.entreprise,
        prenom: baseVivante.prenom,
        nom: baseVivante.nom,
        email: baseVivante.email,
        fonction: baseVivante.fonction,
        linkedin: baseVivante.linkedin,
      })
      .from(baseVivante)
      .where(eq(baseVivante.instanceId, instanceId)),
  );
  return new Set(
    lignes.flatMap((ligne) => [
      ...ligne.cles,
      ...clesDuProspect({
        entreprise: ligne.entreprise,
        prenom: ligne.prenom ?? '',
        nom: ligne.nom,
        email: ligne.email,
        fonction: ligne.fonction ?? '',
        linkedin: ligne.linkedin,
      }),
    ]),
  );
}

export async function chercherNouveauxProspects(
  db: Database,
  client: ClientIA,
  instanceId: string,
  consignes: string,
  nombre: number,
  precedents: ProspectRecherche[] = [],
  progres?: (contacts: ProspectRecherche[], passage: number) => Promise<void>,
) {
  let contacts = [...precedents];
  const refuses = new Set<string>();
  let passage = 0;

  while (contacts.length < nombre) {
    passage++;
    const clesExistantes = await clesDeLaBase(db, instanceId);
    const retenus: ProspectRecherche[] = [];
    const clesRetenues = new Set<string>();
    for (const contact of contacts) {
      const cles = clesDuProspect(contact);
      if (cles.some((cle) => clesExistantes.has(cle) || clesRetenues.has(cle))) {
        refuses.add(identite(contact));
        continue;
      }
      retenus.push(contact);
      for (const cle of cles) clesRetenues.add(cle);
    }
    contacts = retenus;
    await progres?.([...contacts], passage);

    const exclusions = [...new Set([...contacts.map(identite), ...refuses])].slice(-100).join('; ');
    const restant = nombre - contacts.length;
    const candidats = await chercherProspects(
      client,
      `${consignes}\nL’objectif obligatoire est de trouver ${nombre} personnes absentes de la base. Ne propose aucune des personnes déjà rencontrées lors de cette recherche : ${exclusions || 'aucune'}. Diversifie les entreprises et les sources si un passage ne produit aucun nouveau contact.`,
      Math.min(10, Math.max(3, restant * 2)),
    );
    for (const contact of candidats) {
      const cles = clesDuProspect(contact);
      if (cles.some((cle) => clesExistantes.has(cle) || clesRetenues.has(cle))) {
        refuses.add(identite(contact));
        continue;
      }
      contacts.push(contact);
      for (const cle of cles) clesRetenues.add(cle);
      if (contacts.length === nombre) break;
    }
    await progres?.([...contacts], passage);
  }

  return { contacts, passage };
}
