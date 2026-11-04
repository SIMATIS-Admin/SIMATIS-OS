import { noterContactsRecherches } from '../base-vivante/origine.js';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { creerImports, integrerImport } from '../base-vivante/service.js';
import type { Database } from '../db.js';
import { jourDe } from '../pilotage/realisees.js';
import { preferences } from '../preferences/schema.js';
import { CIBLE } from './cible.js';
import type { ClientIA } from './client.js';
import { chercherProspects } from './recherche.js';

export const reglagesRecherche = z.object({
  active: z.boolean(),
  consignes: z.string().trim().min(1).max(5000),
  nombre: z.number().int().min(1).max(100),
  heure: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
});

export type ReglagesRecherche = z.infer<typeof reglagesRecherche>;
export type RoutineRecherche = ReglagesRecherche & {
  dernierJour?: string;
  bilan?: string;
};

const defaut = { active: false, consignes: CIBLE, nombre: 10, heure: '09:00' };
const prefixe = 'routine-recherche-base:';
const cle = (instanceId: string) => prefixe + instanceId;

export async function lireRoutineRecherche(
  db: Database,
  instanceId: string,
): Promise<RoutineRecherche> {
  const [ligne] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.utilisateur, cle(instanceId)));
  return ligne?.options.rechercheBase ?? defaut;
}

export async function enregistrerRoutineRecherche(
  db: Database,
  instanceId: string,
  reglages: ReglagesRecherche,
) {
  await db
    .insert(preferences)
    .values({ utilisateur: cle(instanceId), favoris: [], options: { rechercheBase: reglages } })
    .onConflictDoUpdate({
      target: preferences.utilisateur,
      set: {
        options: sql`jsonb_build_object('rechercheBase', coalesce(${preferences.options}->'rechercheBase', '{}'::jsonb) || ${JSON.stringify(reglages)}::jsonb)`,
      },
    });
  return lireRoutineRecherche(db, instanceId);
}

const csv = (v: string | null) => '"' + (v ?? '').replaceAll('"', '""') + '"';

export async function tournerRecherche(db: Database, client: ClientIA, maintenant = new Date()) {
  const jour = jourDe(maintenant);
  const heure = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(maintenant);
  const lignes = await db
    .select()
    .from(preferences)
    .where(sql`${preferences.utilisateur} like ${prefixe + '%'}`);
  for (const ligne of lignes) {
    const routine = ligne.options.rechercheBase;
    if (!routine?.active || routine.heure > heure || routine.dernierJour === jour) continue;
    const [prise] = await db
      .update(preferences)
      .set({
        options: { rechercheBase: { ...routine, dernierJour: jour, bilan: 'Recherche en cours…' } },
      })
      .where(
        sql`${preferences.utilisateur} = ${ligne.utilisateur}
        and ${preferences.options} = ${JSON.stringify(ligne.options)}::jsonb`,
      )
      .returning({ utilisateur: preferences.utilisateur });
    if (!prise) continue;

    const instanceId = ligne.utilisateur.slice(prefixe.length);
    let bilan: string;
    try {
      const contacts = await chercherProspects(client, routine.consignes, routine.nombre);
      let creees = 0;
      let fusionnees = 0;
      if (contacts.length) {
        const texte = [
          'Entreprise;Prénom;Nom;Fonction;Email;LinkedIn',
          ...contacts.map((c) =>
            [c.entreprise, c.prenom, c.nom, c.fonction, c.email, c.linkedin].map(csv).join(';'),
          ),
        ].join('\n');
        const imports = await creerImports(db, instanceId, {
          nomFichier: `Recherche quotidienne ${jour}.csv`,
          provenance: 'Recherche Codex',
          texte,
          mandat: null,
          collecteLe: jour,
        });
        for (const imp of imports) {
          const resultat = await integrerImport(db, instanceId, imp.id);
          creees += resultat.creees;
          fusionnees += resultat.fusionnees;
        }
      }
      await noterContactsRecherches(db, instanceId, contacts);
      bilan = `${creees} fiche(s) ajoutée(s), ${fusionnees} rapprochée(s), sur ${routine.nombre} contacts visés.`;
    } catch {
      bilan = 'Recherche interrompue. Vérifiez la connexion de Codex sur le Mac.';
    }
    await db
      .update(preferences)
      .set({
        options: sql`jsonb_set(${preferences.options}, '{rechercheBase,bilan}', to_jsonb(${bilan}::text))`,
      })
      .where(eq(preferences.utilisateur, ligne.utilisateur));
  }
}
