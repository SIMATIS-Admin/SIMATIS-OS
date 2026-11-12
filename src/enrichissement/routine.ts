import { noterContactsRecherches } from '../base-vivante/origine.js';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { creerImports, integrerImport } from '../base-vivante/service.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { jourDe } from '../pilotage/realisees.js';
import { preferences } from '../preferences/schema.js';
import type { LimitesIA } from '../ia/limites.js';
import { CIBLE } from './cible.js';
import type { ClientIA } from './client.js';
import { chercherNouveauxProspects, type ProspectRecherche } from './recherche-nouveaux.js';
import { attenteQuota, expliquerEchec, quotaBas, quotaCodex } from './quota.js';
import { rechercheSessions } from './schema.js';
import { cloreSessionRecherche, ouvrirSessionRecherche } from './sessions.js';

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
  // Essais du jour interrompus par un quota ChatGPT bas : la journée reste ouverte pour un nouvel
  // essai après le renouvellement, au plus ESSAIS_PAR_JOUR fois.
  essais?: { jour: string; n: number };
};

export const ESSAIS_PAR_JOUR = 2;

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

export async function tournerRecherche(
  db: Database,
  client: ClientIA,
  maintenant = new Date(),
  // Compteur de limites de la console : sert à ne pas lancer Codex quand son quota est presque épuisé.
  limites?: () => Promise<LimitesIA | null>,
) {
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
    // Quota presque épuisé : la journée n'est pas entamée, la recherche attend le renouvellement.
    const quota = limites ? quotaCodex(await limites().catch(() => null), maintenant) : null;
    if (quotaBas(quota)) {
      const attente = attenteQuota(quota);
      if (routine.bilan !== attente)
        await db
          .update(preferences)
          .set({
            options: sql`jsonb_set(${preferences.options}, '{rechercheBase,bilan}', to_jsonb(${attente}::text))`,
          })
          .where(eq(preferences.utilisateur, ligne.utilisateur));
      continue;
    }
    const essaisAvant = routine.essais?.jour === jour ? routine.essais.n : 0;
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
    const session = await ouvrirSessionRecherche(db, instanceId, {
      mode: 'automatique',
      nombreVise: routine.nombre,
    });
    let fin: Parameters<typeof cloreSessionRecherche>[3];
    let rouvrir = false;
    const contacts: ProspectRecherche[] = [];
    let creees = 0;
    let fusionnees = 0;
    try {
      while (creees < routine.nombre) {
        const recherche = await chercherNouveauxProspects(
          db,
          client,
          instanceId,
          routine.consignes,
          routine.nombre - creees,
        );
        const candidats = recherche.contacts;
        const texte = [
          'Entreprise;Prénom;Nom;Fonction;Email;LinkedIn',
          ...candidats.map((c) =>
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
        await noterContactsRecherches(db, instanceId, candidats);
        contacts.push(...candidats);
      }
      fin = {
        etat: 'terminee',
        trouves: creees,
        ajoutees: creees,
        rapprochees: fusionnees,
        contacts: contacts.map((c) => ({
          entreprise: c.entreprise,
          prenom: c.prenom,
          nom: c.nom,
          fonction: c.fonction,
        })),
      };
      bilan = `${creees} fiche(s) ajoutée(s), ${fusionnees} rapprochée(s), sur ${routine.nombre} contacts visés.`;
    } catch (erreur) {
      const apres = limites ? quotaCodex(await limites().catch(() => null), maintenant) : null;
      const cause = expliquerEchec(erreur, apres);
      // Quota bas : la journée reste ouverte pour un nouvel essai après le renouvellement.
      rouvrir = cause.quotaBas && essaisAvant + 1 < ESSAIS_PAR_JOUR;
      fin = {
        etat: 'erreur',
        trouves: creees,
        ajoutees: creees,
        rapprochees: fusionnees,
        contacts: contacts.map((c) => ({
          entreprise: c.entreprise,
          prenom: c.prenom,
          nom: c.nom,
          fonction: c.fonction,
        })),
        erreur: cause.erreur,
      };
      bilan = cause.bilan;
    }
    await cloreSessionRecherche(db, instanceId, session, fin);
    await db
      .update(preferences)
      .set({
        options: sql`jsonb_set(${preferences.options}, '{rechercheBase,bilan}', to_jsonb(${bilan}::text))`,
      })
      .where(eq(preferences.utilisateur, ligne.utilisateur));
    // Quota bas : on retire le marqueur du jour (la recherche pourra repartir) et on compte l'essai.
    if (rouvrir || essaisAvant > 0) {
      const essais = JSON.stringify({ essais: { jour, n: essaisAvant + 1 } });
      await db
        .update(preferences)
        .set({
          options: rouvrir
            ? sql`jsonb_set(${preferences.options}, '{rechercheBase}', ((${preferences.options}->'rechercheBase') - 'dernierJour') || ${essais}::jsonb)`
            : sql`jsonb_set(${preferences.options}, '{rechercheBase}', (${preferences.options}->'rechercheBase') || ${essais}::jsonb)`,
        })
        .where(eq(preferences.utilisateur, ligne.utilisateur));
    }
  }
}

// Un redémarrage de l'app tue la recherche en cours sans la clore et le jour est déjà marqué fait :
// on clôt la session en erreur et on rouvre le jour pour que la routine la relance.
export async function reprendreRecherchesInterrompues(db: Database, maintenant = new Date()) {
  const jour = jourDe(maintenant);
  const lignes = await db
    .select()
    .from(preferences)
    .where(sql`${preferences.utilisateur} like ${prefixe + '%'}`);
  for (const ligne of lignes) {
    const instanceId = ligne.utilisateur.slice(prefixe.length);
    const ouvertes = await withInstance(db, instanceId, (tx) =>
      tx
        .select({ id: rechercheSessions.id, trouves: rechercheSessions.trouves })
        .from(rechercheSessions)
        .where(
          and(eq(rechercheSessions.mode, 'automatique'), eq(rechercheSessions.etat, 'en_cours')),
        ),
    );
    for (const o of ouvertes)
      await cloreSessionRecherche(db, instanceId, o.id, {
        etat: 'erreur',
        trouves: o.trouves,
        erreur: "Recherche interrompue par un redémarrage de l'application.",
      });
    if (ouvertes.length && ligne.options.rechercheBase?.dernierJour === jour)
      await db
        .update(preferences)
        .set({
          options: sql`jsonb_set(${preferences.options}, '{rechercheBase}', (${preferences.options}->'rechercheBase') - 'dernierJour')`,
        })
        .where(eq(preferences.utilisateur, ligne.utilisateur));
  }
}
