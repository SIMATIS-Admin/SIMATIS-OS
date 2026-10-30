import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import {
  carte,
  creerClient,
  deposer,
  ErreurRelais,
  etat as etatMission,
  ETATS_FINAUX,
  lireEtat,
  lireMessageLibre,
  lireMission,
  lireNote,
  niveauDepuisRepere,
  premiereEtape,
  type Client,
  type Connexion,
  type Enveloppe,
  type Etat,
  type EtatMission,
  type Message,
  type Mission,
  type Sortie,
} from 'os-agents-relay';
import type { Database, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import { deposerSujet } from '../inbox/depot.js';
import type { Instance, InstanceType } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { canWriteReal, propose } from '../propositions/service.js';
import { loadInstanceSecrets, writeInstanceSecret } from '../secrets.js';
import { marquerVu, stockageTx } from './stockage.js';
import { recevoirDonnees } from './synchro.js';
import {
  invitationsPartenaires,
  messagesPartenaires,
  missions,
  partenaires,
  type EntreeHistorique,
  type InvitationPartenaire,
  type EtatMissionLocal,
  type MissionPartenaire,
  type Partenaire,
} from './schema.js';

// The connection with a client's OS is carried by that client's instance (one relay node each):
// what it shares can only come from that instance, by construction.
export const PORTEURS_PARTENAIRES: InstanceType[] = ['mandat'];

export const SECRET_NOEUD = 'RELAIS_NOEUD';
export const SECRET_CLE = 'RELAIS_SECRET';

export type RelaisDeps = {
  url: string;
  // Relay registration key (RELAIS_CLE_INSCRIPTION): lets an instance invite before being invited.
  cleInscription?: string;
  secretsDir: string;
  realWrites: boolean;
  fetch?: typeof fetch;
};

// What processing a received envelope needs: answering goes through the double lock; `noeud`
// (this instance's relay node) recognizes our own records in the references of the CRM profile.
export type ReceptionDeps = { secretsDir: string; realWrites: boolean; noeud?: string };

export class PartenaireRefuse extends Error {}

export const estPorteuse = (instance: Instance) => PORTEURS_PARTENAIRES.includes(instance.type);

export async function clientPour(instance: Instance, deps: RelaisDeps): Promise<Client> {
  const secrets = await loadInstanceSecrets(deps.secretsDir, instance.slug);
  return creerClient({
    url: deps.url,
    ...(secrets[SECRET_NOEUD] ? { noeud: secrets[SECRET_NOEUD] } : {}),
    ...(secrets[SECRET_CLE] ? { secret: secrets[SECRET_CLE] } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
}

// Writing to the relay is writing to a third-party system: same double lock as the other tools.
function verifierEcriture(instance: Instance, deps: RelaisDeps): void {
  if (!estPorteuse(instance)) {
    throw new PartenaireRefuse(
      'Un OS partenaire se connecte depuis l’instance de son client (un mandat).',
    );
  }
  if (!canWriteReal(instance, deps.realWrites)) {
    throw new PartenaireRefuse(
      'Écritures réelles désactivées : rien n’est envoyé au relais (simulation).',
    );
  }
}

export const nomCourt = (nom: string) => nom.split(' · ')[0]?.trim() || nom;

async function enregistrerPartenaire(
  tx: Tx,
  connexion: Pick<Connexion, 'id' | 'partenaire'>,
): Promise<{ partenaire: Partenaire; cree: boolean }> {
  const [cree] = await tx
    .insert(partenaires)
    .values({
      instanceId: currentInstance,
      connexionId: connexion.id,
      noeudId: connexion.partenaire.id,
      nom: connexion.partenaire.nom,
      carte: connexion.partenaire.carte,
    })
    .onConflictDoNothing({ target: [partenaires.instanceId, partenaires.connexionId] })
    .returning();
  if (cree) return { partenaire: cree, cree: true };
  const [existant] = await tx
    .select()
    .from(partenaires)
    .where(
      and(eq(partenaires.instanceId, currentInstance), eq(partenaires.connexionId, connexion.id)),
    );
  if (!existant) throw new Error('Partenaire ni créé ni trouvé');
  return { partenaire: existant, cree: false };
}

function identite(instance: Instance) {
  const nom = `SIMATIS OS · ${instance.nom}`;
  return {
    nom,
    carte: carte({
      nom,
      description: 'Direction commerciale en mode partagé : prospects, rendez-vous, affaires.',
      organisation: 'Simatis',
    }),
  };
}

async function retenirNoeud(
  instance: Instance,
  inscription: { id: string; secret: string },
  deps: RelaisDeps,
): Promise<void> {
  await writeInstanceSecret(deps.secretsDir, instance.slug, SECRET_NOEUD, inscription.id);
  await writeInstanceSecret(deps.secretsDir, instance.slug, SECRET_CLE, inscription.secret);
}

// Pastes an invitation link: registers the instance's node with it the first time, otherwise
// accepts it. The node identity goes to the instance's secrets, never anywhere else.
export async function rejoindre(
  db: Database,
  instance: Instance,
  lien: string,
  deps: RelaisDeps,
  par: string,
): Promise<Partenaire> {
  verifierEcriture(instance, deps);
  const client = await clientPour(instance, deps);
  let resultat;
  try {
    resultat = await client.rejoindre({ lien, ...identite(instance) });
  } catch (error) {
    if (error instanceof ErreurRelais && !error.passagere)
      throw new PartenaireRefuse(error.message);
    throw error;
  }
  const { connexion, inscription } = resultat;
  if (inscription) await retenirNoeud(instance, inscription, deps);
  return withInstance(db, instance.id, async (tx) => {
    const { partenaire } = await enregistrerPartenaire(tx, connexion);
    await logEvent(tx, {
      acteur: par,
      action: `Partenaire connecté : ${partenaire.nom}`,
      details: { connexion: connexion.id },
    });
    return partenaire;
  });
}

// Creates an invitation link to hand to a partner. An instance without a node registers first,
// with the relay registration key; the email is only a label (the relay sends nothing).
export async function inviter(
  db: Database,
  instance: Instance,
  email: string | null,
  deps: RelaisDeps,
  par: string,
): Promise<InvitationPartenaire> {
  verifierEcriture(instance, deps);
  const client = await clientPour(instance, deps);
  let invitation;
  try {
    if (!client.inscrit) {
      if (!deps.cleInscription) {
        throw new PartenaireRefuse(
          'Clé d’inscription du relais absente (RELAIS_CLE_INSCRIPTION) : collez plutôt le lien reçu d’un partenaire.',
        );
      }
      const inscription = await client.inscrire({
        ...identite(instance),
        cle_inscription: deps.cleInscription,
      });
      await retenirNoeud(instance, inscription, deps);
    }
    invitation = await client.inviter(email ? { email } : {});
  } catch (error) {
    if (error instanceof ErreurRelais && !error.passagere)
      throw new PartenaireRefuse(error.message);
    throw error;
  }
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .insert(invitationsPartenaires)
      .values({
        instanceId: currentInstance,
        code: invitation.code,
        lien: invitation.lien,
        email,
        expireAt: new Date(invitation.expire_le),
        creePar: par,
      })
      .returning();
    if (!row) throw new Error('Invitation non enregistrée');
    await logEvent(tx, {
      acteur: par,
      action: `Invitation de partenaire créée${email ? ` pour ${email}` : ''}`,
    });
    return row;
  });
}

export async function invitationsEnAttente(tx: Tx): Promise<InvitationPartenaire[]> {
  return tx
    .select()
    .from(invitationsPartenaires)
    .where(
      and(
        eq(invitationsPartenaires.instanceId, currentInstance),
        isNull(invitationsPartenaires.accepteeAt),
        gt(invitationsPartenaires.expireAt, new Date()),
      ),
    )
    .orderBy(desc(invitationsPartenaires.createdAt));
}

// Cuts the connection at the relay (the partner is told), then here.
export async function couper(
  db: Database,
  instance: Instance,
  id: string,
  deps: RelaisDeps,
  par: string,
): Promise<Partenaire | null> {
  verifierEcriture(instance, deps);
  const [p] = await withInstance(db, instance.id, (tx) =>
    tx
      .select()
      .from(partenaires)
      .where(and(eq(partenaires.instanceId, currentInstance), eq(partenaires.id, id))),
  );
  if (!p) return null;
  if (p.statut === 'coupee') throw new PartenaireRefuse('Connexion déjà coupée.');
  const client = await clientPour(instance, deps);
  try {
    await client.couper(p.connexionId);
  } catch (error) {
    // Already cut or unknown at the relay: the local row still has to follow.
    if (!(error instanceof ErreurRelais && (error.status === 404 || error.status === 409))) {
      throw error;
    }
  }
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .update(partenaires)
      .set({ statut: 'coupee', coupeeAt: new Date(), updatedAt: new Date() })
      .where(and(eq(partenaires.instanceId, currentInstance), eq(partenaires.id, id)))
      .returning();
    await logEvent(tx, { acteur: par, action: `Connexion coupée avec ${p.nom}` });
    return row ?? p;
  });
}

export async function listerPartenaires(tx: Tx): Promise<Partenaire[]> {
  return tx
    .select()
    .from(partenaires)
    .where(eq(partenaires.instanceId, currentInstance))
    .orderBy(partenaires.createdAt);
}

// Partner named by its id or (part of) its name, case-insensitive. Unknown, ambiguous or cut:
// the error lists the active partners, so the agent can ask again.
export async function trouverPartenaire(tx: Tx, nomOuId: string): Promise<Partenaire> {
  const tous = await listerPartenaires(tx);
  const cherche = nomOuId.trim().toLowerCase();
  const exact = tous.find((p) => p.id === nomOuId.trim());
  const trouves = exact ? [exact] : tous.filter((p) => p.nom.toLowerCase().includes(cherche));
  const actifs = tous.filter((p) => p.statut === 'active').map((p) => p.nom);
  const liste = actifs.length
    ? `Partenaires actifs : ${actifs.join(', ')}.`
    : 'Aucun partenaire actif.';
  const [p] = trouves;
  if (!p) throw new PartenaireRefuse(`Partenaire inconnu : ${nomOuId}. ${liste}`);
  if (trouves.length > 1) throw new PartenaireRefuse(`Partenaire ambigu : ${nomOuId}. ${liste}`);
  if (p.statut !== 'active') throw new PartenaireRefuse(`Connexion coupée avec ${p.nom}. ${liste}`);
  return p;
}

export async function partenaireActif(tx: Tx, id: string): Promise<Partenaire> {
  const [p] = await tx
    .select()
    .from(partenaires)
    .where(and(eq(partenaires.instanceId, currentInstance), eq(partenaires.id, id)));
  if (!p) throw new PartenaireRefuse('Partenaire introuvable');
  if (p.statut !== 'active') throw new PartenaireRefuse(`Connexion coupée avec ${p.nom}`);
  return p;
}

export async function missionsRecentes(
  tx: Tx,
  filtre: { partenaireId?: string; etat?: string; limite: number },
) {
  const conditions = [eq(missions.instanceId, currentInstance)];
  if (filtre.partenaireId) conditions.push(eq(missions.partenaireId, filtre.partenaireId));
  if (filtre.etat) conditions.push(eq(missions.etat, filtre.etat as EtatMissionLocal));
  return tx
    .select({
      id: missions.id,
      sens: missions.sens,
      titre: missions.titre,
      consigne: missions.consigne,
      niveau: missions.niveau,
      partenaire: partenaires.nom,
      etat: missions.etat,
      dernierMessage: missions.dernierMessage,
      resultat: missions.resultat,
      creeeLe: missions.createdAt,
      majLe: missions.updatedAt,
    })
    .from(missions)
    .innerJoin(partenaires, eq(partenaires.id, missions.partenaireId))
    .where(and(...conditions))
    .orderBy(desc(missions.updatedAt))
    .limit(filtre.limite);
}

// ---------------------------------------------------------------- reception

const FINAUX: readonly string[] = ETATS_FINAUX;

// First http(s) address found in a result: the subject links to it.
function lienDe(resultat: Record<string, unknown> | null): string | null {
  if (!resultat) return null;
  for (const cle of ['lien', 'url', 'uri']) {
    const v = resultat[cle];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
  }
  const autre = Object.values(resultat).find(
    (v): v is string => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v),
  );
  return autre ?? null;
}

function titreEtat(
  nom: string,
  titre: string,
  etat: string,
  resultat: Record<string, unknown> | null,
) {
  const retenu =
    typeof resultat?.titre === 'string' && resultat.titre.trim() ? resultat.titre : null;
  switch (etat) {
    case 'working':
      return retenu ? `${nom} a accepté « ${retenu} »` : `${nom} a pris en charge « ${titre} »`;
    case 'input-required':
      return `${nom} demande une précision sur « ${titre} »`;
    case 'completed':
      return `${nom} : mission faite, « ${retenu ?? titre} »`;
    case 'rejected':
      return `${nom} a refusé « ${titre} »`;
    case 'failed':
      return `${nom} : échec de « ${titre} »`;
    case 'canceled':
      return `${nom} a annulé « ${titre} »`;
    default:
      return `${nom} a reçu « ${titre} »`;
  }
}

async function partenaireDe(tx: Tx, connexionId: string): Promise<Partenaire | undefined> {
  const [p] = await tx
    .select()
    .from(partenaires)
    .where(
      and(eq(partenaires.instanceId, currentInstance), eq(partenaires.connexionId, connexionId)),
    );
  return p;
}

// The mission is looked up by its id AND the envelope's connection: a partner never moves the
// missions entrusted to another one.
async function missionDe(
  tx: Tx,
  connexionId: string,
  missionId: string | null,
): Promise<{ p: Partenaire; m: MissionPartenaire } | null> {
  const p = await partenaireDe(tx, connexionId);
  if (!p || !missionId) return null;
  const [m] = await tx
    .select()
    .from(missions)
    .where(
      and(
        eq(missions.instanceId, currentInstance),
        eq(missions.id, missionId),
        eq(missions.partenaireId, p.id),
      ),
    );
  return m ? { p, m } : null;
}

async function recevoirEtat(tx: Tx, env: Enveloppe): Promise<void> {
  const e = lireEtat(env.corps as Etat);
  const trouve = await missionDe(tx, env.connexion, e.mission);
  if (!trouve) {
    await logEvent(tx, {
      acteur: 'relais',
      action: 'État ignoré : mission inconnue sur cette connexion',
      details: { enveloppe: env.id },
    });
    return;
  }
  const { p, m } = trouve;
  // Envelopes may arrive out of order: a closed mission stays closed.
  const applique = !(FINAUX.includes(m.etat) && !e.final);
  const entree: EntreeHistorique = {
    etat: e.etat,
    at: e.quand,
    message: e.message || null,
    enveloppe: env.id,
  };
  await tx
    .update(missions)
    .set({
      historique: [...m.historique, entree],
      ...(applique
        ? {
            etat: e.etat,
            dernierMessage: e.message || m.dernierMessage,
            resultat: e.resultat ?? m.resultat,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(missions.instanceId, currentInstance), eq(missions.id, m.id)));
  await logEvent(tx, {
    acteur: 'relais',
    action: `Mission « ${m.titre} » : ${e.etat}${applique ? '' : ' (ignoré, mission déjà close)'}`,
    details: { mission: m.id, enveloppe: env.id },
  });
  if (!applique || (e.etat === 'working' && !e.message)) return;
  await deposerSujet(tx, {
    type: 'autre',
    titre: titreEtat(nomCourt(p.nom), m.titre, e.etat, e.resultat),
    resume: e.message || null,
    origine: 'partenaire',
    source: 'relais',
    sourceId: env.id,
    lien: lienDe(e.resultat),
    // Scale 1 (low) to 5 (high): an outcome Marc has to act on comes first.
    priorite: ['completed', 'rejected', 'failed'].includes(e.etat) ? 4 : 3,
  });
}

// Sends the partner a state of a mission it entrusted here, and records it. Real writes closed:
// recorded only, nothing leaves.
export async function repondreMission(
  tx: Tx,
  reel: boolean,
  m: MissionPartenaire,
  reponse: {
    etat: EtatMission;
    message?: string | null;
    resultat?: Record<string, unknown> | null;
  },
  par: string,
): Promise<MissionPartenaire> {
  const p = await partenaireActif(tx, m.partenaireId);
  const corps = etatMission({
    mission: { id: m.id, ...(m.contextId ? { contextId: m.contextId } : {}) },
    etat: reponse.etat,
    ...(reponse.message ? { message: reponse.message } : {}),
    ...(reponse.resultat ? { resultat: reponse.resultat } : {}),
  });
  const sortie = reel
    ? await deposer({ stockage: stockageTx(tx), connexion: p.connexionId, type: 'etat', corps })
    : null;
  const entree: EntreeHistorique = {
    etat: reponse.etat,
    at: new Date().toISOString(),
    message: reel ? (reponse.message ?? null) : 'Simulation : rien n’est parti au partenaire.',
    enveloppe: sortie?.id ?? null,
  };
  const [row] = await tx
    .update(missions)
    .set({
      etat: reponse.etat,
      dernierMessage: reponse.message || m.dernierMessage,
      resultat: reponse.resultat ?? m.resultat,
      historique: [...m.historique, entree],
      updatedAt: new Date(),
    })
    .where(and(eq(missions.instanceId, currentInstance), eq(missions.id, m.id)))
    .returning();
  await logEvent(tx, {
    acteur: par,
    action: `Mission « ${m.titre} » de ${p.nom} : ${reponse.etat}${reel ? '' : ' (simulation)'}`,
    details: { mission: m.id, ...(sortie ? { enveloppe: sortie.id } : {}) },
  });
  return row ?? m;
}

export async function missionRecue(tx: Tx, id: string): Promise<MissionPartenaire> {
  const [m] = await tx
    .select()
    .from(missions)
    .where(
      and(
        eq(missions.instanceId, currentInstance),
        eq(missions.id, id),
        eq(missions.sens, 'recue'),
      ),
    );
  if (!m) throw new PartenaireRefuse(`Mission reçue inconnue : ${id}`);
  return m;
}

// A mission the partner entrusts here follows the level Marc set on the connection: a proposal of
// the Inbox to accept or refuse (L0, L1), or taken in hand right away for the agent (L2, L3). The
// fixed safeguards hold through the tools the agent uses, like for every other action of the OS.
async function recevoirMission(
  tx: Tx,
  instance: Instance,
  env: Enveloppe,
  deps: ReceptionDeps,
): Promise<void> {
  const p = await partenaireDe(tx, env.connexion);
  if (!p || p.statut !== 'active') {
    await logEvent(tx, {
      acteur: 'relais',
      action: 'Mission ignorée : connexion inconnue ou coupée',
      details: { enveloppe: env.id },
    });
    return;
  }
  const lu = lireMission(env.corps as Mission);
  const [deja] = await tx
    .select({ id: missions.id })
    .from(missions)
    .where(and(eq(missions.instanceId, currentInstance), eq(missions.id, lu.id)));
  if (deja) return;
  const [m] = await tx
    .insert(missions)
    .values({
      id: lu.id,
      instanceId: currentInstance,
      partenaireId: p.id,
      sens: 'recue',
      titre: lu.titre,
      consigne: lu.consigne,
      contexte: lu.contexte,
      etat: 'submitted',
      contextId: lu.contextId,
      niveau: p.niveau,
      historique: [{ etat: 'submitted', at: env.cree_le, message: null, enveloppe: env.id }],
      confieePar: `partenaire:${p.connexionId}`,
    })
    .returning();
  if (!m) throw new Error('Mission non enregistrée');
  await logEvent(tx, {
    acteur: 'relais',
    action: `Mission reçue de ${p.nom} (${p.niveau}) : « ${m.titre} »`,
    details: { mission: m.id, enveloppe: env.id },
  });
  const nom = nomCourt(p.nom);
  const titre = `${nom} vous confie « ${m.titre} »`;
  const etape = premiereEtape(niveauDepuisRepere(p.niveau));
  if (etape.proposer) {
    await propose(
      tx,
      { instance, ...deps },
      {
        type: 'partenaire.mission_recue',
        auteur: `partenaire:${p.connexionId}`,
        niveau: p.niveau,
        contenu: { missionId: m.id, partenaire: nom, titre, consigne: m.consigne },
      },
    );
    return;
  }
  await repondreMission(
    tx,
    canWriteReal(instance, deps.realWrites),
    m,
    { etat: 'working', message: 'Prise en charge par l’agent de Simatis.' },
    'os',
  );
  await deposerSujet(tx, {
    type: 'autre',
    titre,
    resume: `${m.consigne}\n\n${
      etape.validerApres
        ? 'L’agent la prépare ; sa réponse attendra votre validation dans l’Inbox.'
        : `L’agent la fait seul et répond à ${nom}.`
    }`,
    origine: 'partenaire',
    source: 'relais',
    sourceId: env.id,
  });
}

// A free message (no mission): kept, and a subject of the Inbox. A question comes first.
async function recevoirMessageLibre(tx: Tx, env: Enveloppe, p: Partenaire): Promise<void> {
  const n = env.corps as Message;
  // A plain note from an OS without free messages still reads as an info.
  const texte = lireNote(n).texte;
  const lu = lireMessageLibre(n) ?? {
    id: n.messageId,
    type: 'info' as const,
    sujet: texte.split('\n')[0]?.trim().slice(0, 160) || '(sans sujet)',
    texte,
    en_reponse_a: null,
  };
  await tx
    .insert(messagesPartenaires)
    .values({
      id: lu.id,
      instanceId: currentInstance,
      partenaireId: p.id,
      sens: 'recu',
      type: lu.type,
      sujet: lu.sujet,
      texte: lu.texte,
      enReponseA: lu.en_reponse_a,
    })
    .onConflictDoNothing();
  await logEvent(tx, {
    acteur: 'relais',
    action: `Message de ${p.nom} : ${lu.sujet}`,
    details: { enveloppe: env.id, message: lu.id },
  });
  const nom = nomCourt(p.nom);
  await deposerSujet(tx, {
    type: 'autre',
    titre:
      lu.type === 'question'
        ? `${nom} demande : ${lu.sujet}`
        : lu.type === 'reponse'
          ? `${nom} répond : ${lu.sujet}`
          : `${nom} : ${lu.sujet}`,
    resume: lu.texte || null,
    origine: 'partenaire',
    source: 'relais',
    sourceId: env.id,
    priorite: lu.type === 'question' ? 4 : 3,
  });
}

async function recevoirNote(tx: Tx, env: Enveloppe): Promise<void> {
  const n = lireNote(env.corps as Message);
  const trouve = await missionDe(tx, env.connexion, n.mission);
  const p = trouve?.p ?? (await partenaireDe(tx, env.connexion));
  if (p && !n.mission) return recevoirMessageLibre(tx, env, p);
  if (!p) {
    await logEvent(tx, {
      acteur: 'relais',
      action: 'Message ignoré : connexion inconnue',
      details: { enveloppe: env.id },
    });
    return;
  }
  if (trouve) {
    const { m } = trouve;
    const entree: EntreeHistorique = {
      etat: null,
      at: env.cree_le,
      message: n.texte,
      enveloppe: env.id,
    };
    await tx
      .update(missions)
      .set({
        historique: [...m.historique, entree],
        dernierMessage: n.texte,
        updatedAt: new Date(),
      })
      .where(and(eq(missions.instanceId, currentInstance), eq(missions.id, m.id)));
  }
  const ligne = n.texte.split('\n')[0]?.trim().slice(0, 160) ?? '';
  await logEvent(tx, {
    acteur: 'relais',
    action: `Message de ${p.nom}`,
    details: { enveloppe: env.id, ...(trouve ? { mission: trouve.m.id } : {}) },
  });
  await deposerSujet(tx, {
    type: 'autre',
    titre: trouve
      ? `${nomCourt(p.nom)} : « ${trouve.m.titre} », ${ligne}`
      : `${nomCourt(p.nom)} : ${ligne}`,
    resume: n.texte || null,
    origine: 'partenaire',
    source: 'relais',
    sourceId: env.id,
  });
}

async function recevoirConnexion(tx: Tx, env: Enveloppe): Promise<void> {
  const corps = env.corps as {
    evenement: 'acceptee' | 'coupee';
    invitation?: string;
    connexion: { id: string; partenaire?: Connexion['partenaire'] };
  };
  if (corps.evenement === 'acceptee') {
    // An invitation sent from here was accepted: it leaves the pending list.
    if (corps.invitation) {
      await tx
        .update(invitationsPartenaires)
        .set({ accepteeAt: new Date(), connexionId: corps.connexion.id, updatedAt: new Date() })
        .where(
          and(
            eq(invitationsPartenaires.instanceId, currentInstance),
            eq(invitationsPartenaires.code, corps.invitation),
          ),
        );
    }
    if (!corps.connexion.partenaire) return;
    const { partenaire, cree } = await enregistrerPartenaire(tx, {
      id: corps.connexion.id,
      partenaire: corps.connexion.partenaire,
    });
    if (cree) {
      await logEvent(tx, {
        acteur: 'relais',
        action: `Partenaire connecté : ${partenaire.nom}`,
        details: { connexion: corps.connexion.id },
      });
    }
    return;
  }
  const p = await partenaireDe(tx, env.connexion);
  if (!p || p.statut === 'coupee') return;
  await tx
    .update(partenaires)
    .set({ statut: 'coupee', coupeeAt: new Date(), updatedAt: new Date() })
    .where(and(eq(partenaires.instanceId, currentInstance), eq(partenaires.id, p.id)));
  await logEvent(tx, {
    acteur: 'relais',
    action: `Connexion coupée par ${p.nom}`,
    details: { enveloppe: env.id },
  });
  await deposerSujet(tx, {
    type: 'autre',
    titre: `Connexion coupée par ${nomCourt(p.nom)}`,
    resume:
      'Plus rien ne part vers ce partenaire. Rien n’est effacé : les fiches reçues de lui restent ici, à trier si besoin.',
    origine: 'partenaire',
    source: 'relais',
    sourceId: env.id,
  });
}

// Processes one envelope and records it as seen in the same transaction: the kit acknowledges it
// to the relay only after the commit, so a crash in between re-delivers without duplicating.
export async function traiterEnveloppe(
  db: Database,
  instance: Instance,
  env: Enveloppe,
  deps: ReceptionDeps,
): Promise<void> {
  await withInstance(db, instance.id, async (tx) => {
    switch (env.type) {
      case 'etat':
        await recevoirEtat(tx, env);
        break;
      case 'message':
        await recevoirNote(tx, env);
        break;
      case 'connexion':
        await recevoirConnexion(tx, env);
        break;
      case 'mission':
        await recevoirMission(tx, instance, env, deps);
        break;
      case 'donnee': {
        const p = await partenaireDe(tx, env.connexion);
        if (p?.statut === 'active') await recevoirDonnees(tx, instance, env, p, deps);
        else
          await logEvent(tx, {
            acteur: 'relais',
            action: 'Suivi commercial ignoré : connexion inconnue ou coupée',
            details: { enveloppe: env.id },
          });
        break;
      }
      default:
        await logEvent(tx, {
          acteur: 'relais',
          action: `Partenaire : ${String(env.type)} reçue, non prise en charge`,
          details: { enveloppe: env.id },
        });
    }
    await marquerVu(tx, env.id);
  });
}

export async function journaliserInvalide(
  db: Database,
  instance: Instance,
  env: Enveloppe,
  problemes: string[],
): Promise<void> {
  await withInstance(db, instance.id, async (tx) => {
    await logEvent(tx, {
      acteur: 'relais',
      action: `Enveloppe mal formée ignorée (${env.type})`,
      details: { enveloppe: env.id, problemes: problemes.slice(0, 10) },
    });
    await marquerVu(tx, env.id);
  });
}

// An envelope the relay will never take (connection cut, or 30 days unreachable).
export async function abandonner(
  db: Database,
  instance: Instance,
  s: Sortie,
  raison: string,
): Promise<void> {
  await withInstance(db, instance.id, async (tx) => {
    const p = await partenaireDe(tx, s.connexion);
    const nom = p ? nomCourt(p.nom) : 'le partenaire';
    const missionId = s.type === 'mission' && typeof s.corps.id === 'string' ? s.corps.id : null;
    const [m] = missionId
      ? await tx
          .update(missions)
          .set({ etat: 'failed', dernierMessage: `Non envoyée : ${raison}`, updatedAt: new Date() })
          .where(and(eq(missions.instanceId, currentInstance), eq(missions.id, missionId)))
          .returning()
      : [];
    await logEvent(tx, {
      acteur: 'relais',
      action: `Envoi abandonné vers ${nom} (${s.type}) : ${raison}`,
      details: { enveloppe: s.id, ...(m ? { mission: m.id } : {}) },
    });
    await deposerSujet(tx, {
      type: 'autre',
      titre: m ? `Mission non envoyée à ${nom} : « ${m.titre} »` : `Envoi non parti vers ${nom}`,
      resume: `Raison : ${raison}`,
      origine: 'partenaire',
      source: 'relais',
      sourceId: `abandon:${s.id}`,
      priorite: 4,
    });
  });
}
