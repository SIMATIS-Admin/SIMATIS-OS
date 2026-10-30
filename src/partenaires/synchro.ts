import { and, eq } from 'drizzle-orm';
import {
  changement,
  decouper,
  deposer,
  difference,
  ErreurFormat,
  fusionner,
  lireLot,
  lireReference,
  reference,
  retenir,
  type Changement,
  type Conflit,
  type Enveloppe,
  type EtatEchange,
  type Lien,
} from 'os-agents-relay';
import { writeVia } from '../connexions/service.js';
import { pipelineSource } from '../crm/pipeline.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { deposerSujet } from '../inbox/depot.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { canWriteReal, propose } from '../propositions/service.js';
import {
  CIBLE_LIEN,
  creable,
  creerFiche,
  ecrireChamps,
  ecrireLiens,
  etapesPipeline,
  existe,
  idsPartageables,
  lireFiches,
  type FicheLocale,
  type LiensLocaux,
} from './crm-profil.js';
import {
  crmPartages,
  OBJETS_CRM,
  partenaires,
  type CrmPartage,
  type ObjetCrm,
  type ObjetSynchro,
  type Partenaire,
} from './schema.js';
import { nomCourt, type ReceptionDeps } from './service.js';
import { stockageTx } from './stockage.js';

// The CRM sync with a partner (profile crm/1, kit crm.js). Each pass compares the shared records
// with the state last exchanged (crm_partages) and sends only the difference; a received change is
// merged with the kit's rules and written like a change made in the OS.

const PASSE_COMPLETE_MS = 86_400_000;
// Records changed a little before the last pass are read again: a transaction still open then
// commits with an older updated_at. Reading twice sends nothing twice (the state says so).
const MARGE_MS = 5 * 60_000;

const LIBELLES: Record<ObjetSynchro, string> = {
  pipeline: 'Pipeline',
  entreprise: 'Entreprise',
  contact: 'Contact',
  affaire: 'Affaire',
  tache: 'Tâche',
  rendez_vous: 'Rendez-vous',
  activite: 'Activité',
};

const source = (p: Partenaire) => `partenaire:${p.connexionId}`;

async function partagesDe(tx: Tx, p: Partenaire, objet: ObjetSynchro): Promise<CrmPartage[]> {
  return tx
    .select()
    .from(crmPartages)
    .where(
      and(
        eq(crmPartages.instanceId, currentInstance),
        eq(crmPartages.partenaireId, p.id),
        eq(crmPartages.objet, objet),
      ),
    );
}

async function partageParRef(tx: Tx, p: Partenaire, ref: string): Promise<CrmPartage | undefined> {
  const [row] = await tx
    .select()
    .from(crmPartages)
    .where(
      and(
        eq(crmPartages.instanceId, currentInstance),
        eq(crmPartages.partenaireId, p.id),
        eq(crmPartages.ref, ref),
      ),
    );
  return row;
}

async function retenirEtat(
  tx: Tx,
  p: Partenaire,
  objet: ObjetSynchro,
  ref: string,
  localId: string | null,
  etat: EtatEchange,
): Promise<void> {
  await tx
    .insert(crmPartages)
    .values({ instanceId: currentInstance, partenaireId: p.id, objet, ref, localId, etat })
    .onConflictDoUpdate({
      target: [crmPartages.instanceId, crmPartages.partenaireId, crmPartages.ref],
      set: { etat, localId, updatedAt: new Date() },
    });
}

// Local ids → references, for the links of what is sent. A record the partner created keeps its
// reference; ours are `<our node>/<id>`.
async function references(tx: Tx, p: Partenaire, noeud: string) {
  const lignes = await tx
    .select({ objet: crmPartages.objet, localId: crmPartages.localId, ref: crmPartages.ref })
    .from(crmPartages)
    .where(and(eq(crmPartages.instanceId, currentInstance), eq(crmPartages.partenaireId, p.id)));
  const connues = new Map(
    lignes.flatMap((l) => (l.localId ? [[`${l.objet}:${l.localId}`, l.ref]] : [])),
  );
  return {
    de: (objet: ObjetSynchro, id: string) => connues.get(`${objet}:${id}`) ?? reference(noeud, id),
    ajouter: (objet: ObjetSynchro, id: string, ref: string) => connues.set(`${objet}:${id}`, ref),
  };
}
type References = Awaited<ReturnType<typeof references>>;

// ---------------------------------------------------------------- sending

export type BilanSynchro = { envoyes: number; instantane: boolean; ignores: number };

// One pass for one partner: snapshot the first time, then what changed since the last pass, and
// every day a full pass (links removed, records gone). Sending to the relay is a third-party
// write: closed double lock, nothing is read nor recorded as sent.
export async function synchroniser(
  tx: Tx,
  instance: Instance,
  p: Partenaire,
  noeud: string,
  realWrites: boolean,
  maintenant = new Date(),
): Promise<BilanSynchro | null> {
  if (p.statut !== 'active' || !canWriteReal(instance, realWrites)) return null;
  const complete =
    !p.instantaneAt ||
    !p.passeCompleteAt ||
    maintenant.getTime() - p.passeCompleteAt.getTime() > PASSE_COMPLETE_MS;
  const depuis = complete || !p.synchroAt ? null : new Date(p.synchroAt.getTime() - MARGE_MS);
  const refs = await references(tx, p, noeud);
  const changements: Changement[] = [];
  let ignores = 0;

  const envoyer = async (
    objet: ObjetSynchro,
    localId: string | null,
    ref: string,
    etat: EtatEchange | null,
    fiche: { champs: Record<string, unknown>; liens?: Record<string, Lien> },
    modifieLe: Date,
  ) => {
    const diff = difference(etat, { ...fiche, modifie_le: modifieLe.toISOString() });
    if (!diff) return;
    let c: Changement;
    try {
      c = changement({ objet, ref, modifie_le: modifieLe.toISOString(), ...diff });
    } catch (error) {
      if (!(error instanceof ErreurFormat)) throw error;
      ignores++;
      await logEvent(tx, {
        acteur: 'os',
        action: `${LIBELLES[objet]} non partagée avec ${p.nom} : format refusé`,
        details: { ref, problemes: error.problemes.slice(0, 5) },
      });
      return;
    }
    const suivant = retenir(etat, c);
    if (suivant) await retenirEtat(tx, p, objet, ref, localId, suivant);
    changements.push(c);
  };

  // The pipeline travels first: the other side shows and offers the same stages.
  const [pipeline] = await partagesDe(tx, p, 'pipeline');
  await envoyer(
    'pipeline',
    null,
    pipeline?.ref ?? reference(noeud, 'pipeline'),
    pipeline?.etat ?? null,
    { champs: { etapes: await etapesPipeline(tx) } },
    maintenant,
  );

  for (const objet of OBJETS_CRM) {
    if (!p.voit.objets.includes(objet)) continue;
    const partages = await partagesDe(tx, p, objet);
    const parId = new Map(partages.flatMap((s) => (s.localId ? [[s.localId, s]] : [])));
    for (const f of await lireFiches(tx, objet, p.voit, { depuis })) {
      const s = parId.get(f.id);
      if (s?.detacheAt) continue;
      await envoyer(
        objet,
        f.id,
        s?.ref ?? refs.de(objet, f.id),
        s?.etat ?? null,
        { champs: f.champs, liens: liensVers(f.liens, p, refs) },
        f.modifieLe,
      );
    }
    // A shared record gone (deleted, or a meeting no longer commercial): the partner is asked.
    const suivis = partages.filter((s) => s.localId && !s.detacheAt);
    const restants = await idsPartageables(
      tx,
      objet,
      suivis.map((s) => s.localId as string),
    );
    for (const s of suivis.filter((x) => !restants.has(x.localId as string))) {
      changements.push(
        changement({ objet, ref: s.ref, action: 'supprime', modifie_le: maintenant.toISOString() }),
      );
      await tx.delete(crmPartages).where(eq(crmPartages.id, s.id));
    }
  }

  const instantane = !p.instantaneAt;
  for (const corps of decouper(changements, instantane ? { instantane: true } : {})) {
    await deposer({ stockage: stockageTx(tx), connexion: p.connexionId, type: 'donnee', corps });
  }
  await tx
    .update(partenaires)
    .set({
      synchroAt: maintenant,
      ...(complete ? { passeCompleteAt: maintenant } : {}),
      ...(instantane ? { instantaneAt: maintenant } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(partenaires.instanceId, currentInstance), eq(partenaires.id, p.id)));
  if (changements.length || instantane) {
    await logEvent(tx, {
      acteur: 'os',
      action: `Suivi commercial envoyé à ${p.nom}${instantane ? ' (instantané)' : ''} : ${changements.length} changement(s)`,
    });
  }
  return { envoyes: changements.length, instantane, ignores };
}

// Links to an object the partner does not see are not shared at all.
function liensVers(liens: LiensLocaux, p: Partenaire, refs: References): Record<string, Lien> {
  const out: Record<string, Lien> = {};
  for (const [nom, v] of Object.entries(liens)) {
    const cible = CIBLE_LIEN[nom];
    if (!cible || !p.voit.objets.includes(cible)) continue;
    out[nom] = Array.isArray(v) ? v.map((id) => refs.de(cible, id)) : v ? refs.de(cible, v) : null;
  }
  return out;
}

// ---------------------------------------------------------------- reception

// The local record a reference names: one the partner created (crm_partages), or ours.
async function localDe(
  tx: Tx,
  p: Partenaire,
  noeud: string | null,
  objet: ObjetCrm,
  ref: string,
): Promise<{ partage: CrmPartage | undefined; localId: string | null }> {
  const partage = await partageParRef(tx, p, ref);
  if (partage) return { partage, localId: partage.localId };
  const { noeud: origine, id } = lireReference(ref);
  if (noeud && origine === noeud && (await existeSur(tx, objet, id)))
    return { partage, localId: id };
  return { partage, localId: null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const existeSur = async (tx: Tx, objet: ObjetCrm, id: string) =>
  UUID.test(id) && (await existe(tx, objet, id));

// Received references → local ids. A target unknown here is left out of the link.
async function liensLocaux(
  tx: Tx,
  p: Partenaire,
  noeud: string | null,
  liens: Record<string, Lien>,
): Promise<LiensLocaux> {
  const out: LiensLocaux = {};
  for (const [nom, v] of Object.entries(liens)) {
    const cible = CIBLE_LIEN[nom];
    if (!cible || !p.voit.objets.includes(cible)) continue;
    const un = async (ref: string) => (await localDe(tx, p, noeud, cible, ref)).localId;
    if (Array.isArray(v)) {
      const ids: string[] = [];
      for (const ref of v) {
        const id = await un(ref);
        if (id) ids.push(id);
      }
      out[nom] = ids;
    } else out[nom] = v ? await un(v) : null;
  }
  return out;
}

// What a partner may not change here: fields it does not see, and the qualification unless shared.
function filtrerRecu(c: Changement, p: Partenaire): Changement {
  if (!c.champs) return c;
  const champs = { ...c.champs };
  for (const cle of p.voit.champsExclus) {
    const [o, champ] = cle.split('.');
    if (o !== c.objet || !champ) continue;
    delete champs[champ];
    if (champ === 'email') delete champs.emails;
  }
  if (c.objet === 'affaire' && !p.voit.qualification) {
    delete champs.qualification;
    delete champs.potentiel;
    delete champs.faisabilite;
  }
  return { ...c, champs };
}

const valeur = (v: unknown) =>
  v === null || v === undefined || (Array.isArray(v) && !v.length)
    ? '(vide)'
    : typeof v === 'string'
      ? v
      : JSON.stringify(v);

function resumeConflits(conflits: Conflit[], nom: string): string {
  return conflits
    .map((c) => {
      const [garde, ecarte] = c.gagnant === 'recu' ? [c.recu, c.local] : [c.local, c.recu];
      return `${c.nom} : « ${valeur(garde)} » gardée (${c.gagnant === 'recu' ? nom : 'ici'}, la plus récente) ; « ${valeur(ecarte)} » écartée.`;
    })
    .join('\n');
}

// The client's CRM: a change received from a partner takes the path of a change made by Marc in
// the OS. Under HubSpot written both ways, the same operations, under the same double lock.
async function versCrmClient(
  tx: Tx,
  instance: Instance,
  objet: ObjetCrm,
  id: string,
  champs: Record<string, unknown>,
  deps: ReceptionDeps,
): Promise<string | null> {
  const src = await pipelineSource(tx);
  if (!src.hubspot || !src.ecrit) return null;
  const exclus = src.hubspot.champsExclus;
  const garder = (correspondance: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(correspondance).flatMap(([champ, propriete]) =>
        Object.hasOwn(champs, champ) && !exclus.includes(propriete) ? [[champ, champs[champ]]] : [],
      ),
    );
  const ops: { op: string; data: Record<string, unknown> }[] = [];
  if (objet === 'affaire') {
    if (typeof champs.etape === 'string' && src.hubspot.etapes.some((e) => e.id === champs.etape))
      ops.push({ op: 'deal.stage', data: { opportuniteId: id, etape: champs.etape } });
    const v = garder({ titre: 'dealname', montant: 'amount', echeance: 'closedate' });
    if (Object.keys(v).length) ops.push({ op: 'deal.update', data: { opportuniteId: id, ...v } });
  } else if (objet === 'contact') {
    const v = garder({ nom: 'lastname', email: 'email', telephone: 'phone', fonction: 'jobtitle' });
    if (Object.keys(v).length) ops.push({ op: 'contact.update', data: { contactId: id, ...v } });
  } else if (objet === 'entreprise') {
    const v = garder({
      nom: 'name',
      ville: 'city',
      domaine: 'domain',
      taille: 'numberofemployees',
    });
    if (Object.keys(v).length) ops.push({ op: 'company.update', data: { entrepriseId: id, ...v } });
  }
  let simulation = false;
  try {
    for (const op of ops)
      simulation = (await writeVia(tx, instance, 'crm', op, deps)).simulation || simulation;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (ops.length)
    await logEvent(tx, {
      acteur: 'os',
      action: `Modification d’un partenaire reportée dans HubSpot${simulation ? ' (simulation : HubSpot inchangé)' : ''}`,
      details: { objet, id, ops: ops.map((o) => o.op) },
    });
  return null;
}

// A `donnee` envelope: a batch of changes of the partner, applied in order.
export async function recevoirDonnees(
  tx: Tx,
  instance: Instance,
  env: Enveloppe,
  p: Partenaire,
  deps: ReceptionDeps,
): Promise<void> {
  const { changements, instantane } = lireLot(env.corps);
  const nom = nomCourt(p.nom);
  const bilan = { crees: 0, modifies: 0, ignores: 0, conflits: 0, suppressions: 0 };
  const refs = await references(tx, p, deps.noeud ?? '');
  for (const brut of changements) {
    if (brut.objet === 'pipeline' || !p.voit.objets.includes(brut.objet)) {
      // SIMATIS OS's pipeline is the reference; an object Marc does not share stays out.
      bilan.ignores++;
      continue;
    }
    const objet = brut.objet;
    const c = filtrerRecu(brut, p);
    const { partage, localId } = await localDe(tx, p, deps.noeud ?? null, objet, c.ref);
    if (partage?.detacheAt) {
      bilan.ignores++;
      continue;
    }
    const [local] = localId ? await lireFiches(tx, objet, p.voit, { ids: [localId] }) : [];
    if (localId && !local) {
      // Ours, deleted here: our deletion is on its way.
      bilan.ignores++;
      continue;
    }
    const fiche: FicheLocale | undefined = local;
    const fusion = fusionner(
      partage?.etat ?? null,
      fiche
        ? {
            champs: fiche.champs,
            liens: liensVers(fiche.liens, p, refs),
            modifie_le: fiche.modifieLe.toISOString(),
          }
        : null,
      c,
    );

    if (fusion.suppression) {
      if (partage && fiche) {
        // Never deleted here alone: detached from the share, and Marc is asked.
        await tx
          .update(crmPartages)
          .set({ detacheAt: new Date(), updatedAt: new Date() })
          .where(eq(crmPartages.id, partage.id));
        await propose(
          tx,
          { instance, ...deps },
          {
            type: 'partenaire.suppression',
            auteur: source(p),
            niveau: 'L1',
            contenu: {
              partenaireId: p.id,
              objet,
              localId: fiche.id,
              titre: `${LIBELLES[objet]} « ${fiche.libelle} » supprimée chez ${nom} : la supprimer ici aussi ?`,
            },
          },
        );
        bilan.suppressions++;
      } else if (partage) await tx.delete(crmPartages).where(eq(crmPartages.id, partage.id));
      continue;
    }

    let id = fiche?.id ?? null;
    const appliquer = fusion.appliquer;
    if (!fiche) {
      if (!appliquer || !creable(objet, appliquer.champs)) {
        bilan.ignores++;
        continue;
      }
      id = await creerFiche(tx, objet, appliquer.champs, { source: source(p), sourceId: c.ref });
      refs.ajouter(objet, id, c.ref);
      if (objet === 'contact' && Object.hasOwn(appliquer.champs, 'emails'))
        await ecrireChamps(tx, objet, id, { emails: appliquer.champs.emails });
      await ecrireLiens(
        tx,
        objet,
        id,
        await liensLocaux(tx, p, deps.noeud ?? null, appliquer.liens),
      );
      bilan.crees++;
    } else if (appliquer) {
      await ecrireChamps(tx, objet, fiche.id, appliquer.champs);
      await ecrireLiens(
        tx,
        objet,
        fiche.id,
        await liensLocaux(tx, p, deps.noeud ?? null, appliquer.liens),
      );
      bilan.modifies++;
      if (fiche.source === 'hubspot') {
        const refus = await versCrmClient(tx, instance, objet, fiche.id, appliquer.champs, deps);
        if (refus)
          await deposerSujet(tx, {
            type: 'autre',
            titre: `Non reporté dans HubSpot : ${LIBELLES[objet].toLowerCase()} « ${fiche.libelle} »`,
            resume: `Modifié par ${nom}, à jour ici ; HubSpot a refusé : ${refus}`,
            origine: 'partenaire',
            source: 'relais',
            sourceId: `hubspot:${env.id}:${c.ref}`,
            priorite: 4,
          });
      }
    }
    if (id && fusion.etat) await retenirEtat(tx, p, objet, c.ref, id, fusion.etat);
    if (fusion.conflits.length) {
      bilan.conflits++;
      const nommee = appliquer?.champs.nom ?? appliquer?.champs.titre;
      const libelle = fiche?.libelle ?? (typeof nommee === 'string' ? nommee : c.ref);
      await deposerSujet(tx, {
        type: 'autre',
        titre: `Modifiée des deux côtés avec ${nom} : ${LIBELLES[objet].toLowerCase()} « ${libelle} »`,
        resume: resumeConflits(fusion.conflits, nom),
        origine: 'partenaire',
        source: 'relais',
        sourceId: `conflit:${env.id}:${c.ref}`,
      });
    }
  }
  await logEvent(tx, {
    acteur: 'relais',
    action: `Suivi commercial reçu de ${p.nom}${instantane ? ` (instantané ${instantane.page}/${instantane.pages})` : ''} : ${bilan.crees} créée(s), ${bilan.modifies} modifiée(s), ${bilan.suppressions} suppression(s) à confirmer, ${bilan.conflits} conflit(s), ${bilan.ignores} ignorée(s)`,
    details: { enveloppe: env.id },
  });
}
