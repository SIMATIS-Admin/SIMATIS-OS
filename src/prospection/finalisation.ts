import { and, asc, eq } from 'drizzle-orm';
import { zoned } from '../connecteurs/google/creneaux.js';
import type { ImageIntegree } from '../connecteurs/google/google.js';
import { getConnector, writeVia, type ConnexionDeps } from '../connexions/service.js';
import { CrmIndisponible } from '../crm/service.js';
import { crmHubspot, createTache, updateTache } from '../crm/taches.js';
import { canWriteReal } from '../propositions/service.js';
import type { Database, Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { decaler, jourDe } from '../pilotage/realisees.js';
import { CampagneIntrouvable, CampagneInvalide, type BrouillonVue } from './campagnes.js';
import { nettoyerCorps } from './redaction.js';
import {
  prospectionBrouillons,
  prospectionCampagnes,
  prospectionOccurrences,
  prospectionSignatures,
  prospectionSuiviFroid,
  type ReglageCampagne,
  type ResultatCampagne,
  type SuiviBrouillon,
} from './schema.js';

const FUSEAU = 'Europe/Paris';
const THEMES: Record<ReglageCampagne['offre'], string> = {
  vma: 'Test de VMA',
  diagnostic: 'Diagnostic',
  'les-deux': 'Test de VMA',
  kairos: 'Kairos',
};
export const themeDe = (offre: ReglageCampagne['offre']) => THEMES[offre];

const ouvre = (jour: string) => {
  const w = new Date(`${jour}T12:00:00Z`).getUTCDay();
  return w >= 1 && w <= 5;
};

// n échéances étalées sur les jours ouvrés de [depuis + plage[0], depuis + plage[1]] : une relance
// groupée ne tombe pas le même jour pour tout le monde.
export function suiviDates(n: number, plage: [number, number], depuis: string): string[] {
  const jours = Array.from({ length: plage[1] - plage[0] + 1 }, (_, k) =>
    decaler(depuis, plage[0] + k),
  ).filter(ouvre);
  if (jours.length === 0) return Array.from({ length: n }, () => decaler(depuis, plage[0]));
  return Array.from({ length: n }, (_, i) => jours[Math.floor((i * jours.length) / n)] as string);
}

const PLAGES_SUIVI: Record<'courte' | 'longue', [number, number]> = {
  courte: [14, 28],
  longue: [30, 60],
};

const dateValide = (date: string | null | undefined): date is string =>
  !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= jourDe(new Date());

type Patch = {
  objet?: string;
  corps?: string;
  etat?: 'pret' | 'ecarte';
  suiviType?: SuiviBrouillon;
  suiviDate?: string | null;
};

// Relecture : Marc corrige le texte, écarte un mail ou règle son suivi. « Prêt » valide aussi un
// brouillon que Claude avait marqué « à vérifier ».
export async function modifierBrouillon(
  tx: Executor,
  id: string,
  patch: Patch,
): Promise<BrouillonVue> {
  const [b] = await tx
    .select({ b: prospectionBrouillons, statut: prospectionCampagnes.statut })
    .from(prospectionBrouillons)
    .innerJoin(prospectionCampagnes, eq(prospectionCampagnes.id, prospectionBrouillons.campagneId))
    .where(
      and(eq(prospectionBrouillons.instanceId, currentInstance), eq(prospectionBrouillons.id, id)),
    );
  if (!b) throw new CampagneIntrouvable('Brouillon introuvable.');
  if (b.statut !== 'relecture') {
    throw new CampagneInvalide("Cette campagne n'est plus en relecture.");
  }
  if (patch.objet !== undefined && !patch.objet.trim())
    throw new CampagneInvalide("L'objet est vide.");
  if (patch.corps !== undefined && !patch.corps.trim())
    throw new CampagneInvalide('Le mail est vide.');
  if (b.b.etat === 'cree') throw new CampagneInvalide('Ce brouillon est déjà créé.');

  const suiviType = patch.suiviType ?? b.b.suiviType;
  let suiviDate: Date | null = b.b.suiviDate;
  if (patch.suiviType !== undefined || patch.suiviDate !== undefined) {
    if (suiviType === 'citee') {
      const date = patch.suiviDate ?? (b.b.suiviDate ? jourDe(b.b.suiviDate) : null);
      if (!dateValide(date)) {
        throw new CampagneInvalide(
          'Indiquez la date citée par le contact (aujourd’hui ou plus tard).',
        );
      }
      suiviDate = zoned(date, '09:00', FUSEAU);
    } else {
      suiviDate = null;
    }
  }
  const [row] = await tx
    .update(prospectionBrouillons)
    .set({
      ...(patch.objet !== undefined ? { objet: patch.objet.trim().slice(0, 300) } : {}),
      ...(patch.corps !== undefined ? { corps: nettoyerCorps(patch.corps) } : {}),
      ...(patch.etat !== undefined
        ? { etat: patch.etat, note: patch.etat === 'pret' ? null : b.b.note }
        : {}),
      // Retoucher un brouillon à vérifier vaut validation.
      ...(patch.etat === undefined &&
      b.b.etat === 'a_verifier' &&
      (patch.objet !== undefined || patch.corps !== undefined)
        ? { etat: 'pret' as const, note: null }
        : {}),
      suiviType,
      suiviDate,
      updatedAt: new Date(),
    })
    .where(eq(prospectionBrouillons.id, id))
    .returning();
  if (!row) throw new CampagneIntrouvable('Brouillon introuvable.');
  return sansInstance(row);
}

const sansInstance = <T extends { instanceId: string; source: string; sourceId: string | null }>(
  row: T,
): Omit<T, 'instanceId' | 'source' | 'sourceId'> =>
  Object.fromEntries(
    Object.entries(row).filter(([k]) => !['instanceId', 'source', 'sourceId'].includes(k)),
  ) as Omit<T, 'instanceId' | 'source' | 'sourceId'>;

// Création des brouillons de messagerie (signature en image, dans le fil du contact), puis, pour
// chacun : l'occurrence de prospection, la tâche de suivi et la tâche d'origine faite. En simulation
// (écritures réelles fermées), rien n'est écrit et la campagne reste en relecture : Marc pourra
// recommencer après avoir ouvert les verrous.
export async function finaliserCampagne(
  db: Database,
  instance: Instance,
  campagneId: string,
  deps: ConnexionDeps,
  // `envoi` : les mails partent tout de suite (au lieu de brouillons). Réservé au double verrou ouvert.
  { envoi = false }: { envoi?: boolean } = {},
): Promise<ResultatCampagne> {
  if (envoi && !canWriteReal(instance, deps.realWrites)) {
    throw new CampagneInvalide(
      'Envoi direct fermé : il faut ouvrir les deux verrous (variable du serveur et interrupteur administrateur). Vous pouvez créer les brouillons dans la messagerie.',
    );
  }
  return withInstance(db, instance.id, async (tx) => {
    // Le verrou de ligne empêche une seconde finalisation de la même campagne en parallèle.
    const [campagne] = await tx
      .select()
      .from(prospectionCampagnes)
      .where(
        and(
          eq(prospectionCampagnes.instanceId, currentInstance),
          eq(prospectionCampagnes.id, campagneId),
        ),
      )
      .for('update');
    if (!campagne) throw new CampagneIntrouvable('Campagne introuvable.');
    if (campagne.statut !== 'relecture') {
      throw new CampagneInvalide("Cette campagne n'est pas en relecture.");
    }
    const brouillons = await tx
      .select()
      .from(prospectionBrouillons)
      .where(
        and(
          eq(prospectionBrouillons.instanceId, currentInstance),
          eq(prospectionBrouillons.campagneId, campagneId),
        ),
      )
      .orderBy(asc(prospectionBrouillons.createdAt), asc(prospectionBrouillons.contactNom));
    if (!(await getConnector(tx, 'messagerie'))?.connector.write) {
      throw new CampagneInvalide(
        'Aucune messagerie branchée sur cette instance : connectez-la dans Paramètres, onglet Connexions.',
      );
    }
    const aVerifier = brouillons.filter((b) => b.etat === 'a_verifier').length;
    if (aVerifier > 0) {
      throw new CampagneInvalide(
        `${aVerifier} ${aVerifier > 1 ? 'brouillons sont' : 'brouillon est'} à vérifier : ouvrez-${aVerifier > 1 ? 'les' : 'le'} avant de continuer.`,
      );
    }
    const prets = brouillons.filter((b) => b.etat === 'pret');
    if (prets.length === 0) throw new CampagneInvalide('Aucun brouillon prêt à créer.');

    const r = campagne.reglage;
    const [signature] = r.signatureId
      ? await tx
          .select()
          .from(prospectionSignatures)
          .where(
            and(
              eq(prospectionSignatures.instanceId, currentInstance),
              eq(prospectionSignatures.id, r.signatureId),
            ),
          )
      : [];
    const images: ImageIntegree[] = signature
      ? [{ cid: 'signature', typeMime: signature.typeMime, base64: signature.image }]
      : [];

    // Échéances de suivi : réglage de la campagne, sauf une date citée par le contact.
    const aEtaler = prets.filter((b) => b.suiviType === 'delai');
    const etalees =
      r.suivi.type === 'date'
        ? aEtaler.map(() => r.suivi.date as string)
        : suiviDates(aEtaler.length, PLAGES_SUIVI[r.suivi.type], jourDe(new Date()));
    const echeanceDe = new Map<string, string>();
    aEtaler.forEach((b, i) => echeanceDe.set(b.id, etalees[i] as string));

    const froid = campagne.mode === 'froid';
    const crm = froid ? null : await crmHubspot(tx);
    const resultat: ResultatCampagne = {
      brouillons: 0,
      simulation: false,
      suivisCrees: 0,
      suivisNonCrees: 0,
      clos: 0,
      faites: 0,
      echecs: 0,
      envoye: envoi,
    };

    for (const b of prets) {
      let ecrit;
      try {
        ecrit = await writeVia(
          tx,
          instance,
          'messagerie',
          {
            op: envoi ? 'message.send' : 'draft.create',
            data: {
              to: b.contactEmail,
              subject: b.objet ?? '',
              html: `${b.corps ?? ''}${images.length ? '<p><img src="cid:signature" alt="Signature" style="max-width:480px"></p>' : ''}`,
              ...(images.length ? { images } : {}),
              ...(b.threadId ? { threadId: b.threadId } : {}),
            },
          },
          deps,
        );
      } catch (e) {
        resultat.echecs += 1;
        await tx
          .update(prospectionBrouillons)
          .set({
            note: `Brouillon refusé par la messagerie : ${e instanceof Error ? e.message : String(e)}`,
          })
          .where(eq(prospectionBrouillons.id, b.id));
        continue;
      }
      if (ecrit.simulation) {
        // Les écritures réelles sont fermées : rien n'a été créé, rien n'est enregistré.
        return { ...resultat, simulation: true };
      }
      resultat.brouillons += 1;
      await tx
        .update(prospectionBrouillons)
        .set({ etat: 'cree', updatedAt: new Date() })
        .where(eq(prospectionBrouillons.id, b.id));
      await tx.insert(prospectionOccurrences).values({
        instanceId: currentInstance,
        mode: campagne.mode,
        contactId: b.contactId,
        baseId: b.baseId,
        contactNom: b.contactNom,
        societe: b.societe,
        theme: themeDe(r.offre),
        touche: b.touche,
        etat: envoi ? 'envoye' : 'brouillon',
        ...(envoi ? { envoyeAt: new Date() } : {}),
        threadId: b.threadId,
        lot: campagneId,
      });

      if (froid && b.baseId) {
        // Le contact avance dans la séquence ; « dossier clos » décidé par Marc l'en retire.
        const statut = b.suiviType === 'clos' ? ('epuise' as const) : ('actif' as const);
        await tx
          .insert(prospectionSuiviFroid)
          .values({
            instanceId: currentInstance,
            baseId: b.baseId,
            touches: b.touche,
            touchesMax: r.touchesMax,
            derniereLe: new Date(),
            statut,
          })
          .onConflictDoUpdate({
            target: [prospectionSuiviFroid.instanceId, prospectionSuiviFroid.baseId],
            set: {
              touches: b.touche,
              touchesMax: r.touchesMax,
              derniereLe: new Date(),
              statut,
              updatedAt: new Date(),
            },
          });
      }

      if (b.suiviType === 'clos') {
        resultat.clos += 1;
      } else {
        const jour =
          b.suiviType === 'citee' && b.suiviDate
            ? jourDe(b.suiviDate)
            : (echeanceDe.get(b.id) as string);
        const tache = {
          titre: froid
            ? `Relance à froid (MAIL), touche ${b.touche + 1} : ${b.contactNom}`
            : `RELANCE de prospection (MAIL) : ${b.contactNom}`,
          type: 'email' as const,
          echeance: zoned(jour, '09:00', FUSEAU).toISOString(),
          contactId: b.contactId,
        };
        let dansLeCrm = true;
        try {
          const cree = await createTache(tx, instance, { ...tache, hubspot: crm !== null }, deps);
          if ('simulation' in cree) dansLeCrm = false;
        } catch (e) {
          if (!(e instanceof CrmIndisponible)) throw e;
          // HubSpot refuse (lecture seule…) : le suivi existe quand même, dans l'OS.
          await createTache(tx, instance, { ...tache, hubspot: false }, deps);
          dansLeCrm = false;
        }
        if (dansLeCrm) resultat.suivisCrees += 1;
        else resultat.suivisNonCrees += 1;
      }

      if (b.tacheId) {
        try {
          const fait = await updateTache(tx, instance, b.tacheId, { fait: true }, deps);
          if (fait && !('simulation' in fait)) resultat.faites += 1;
        } catch (e) {
          if (!(e instanceof CrmIndisponible)) throw e;
        }
      }
    }

    if (resultat.echecs === 0) {
      await tx
        .update(prospectionCampagnes)
        .set({ statut: 'terminee', termineAt: new Date(), resultat, updatedAt: new Date() })
        .where(eq(prospectionCampagnes.id, campagneId));
    }
    return resultat;
  });
}
