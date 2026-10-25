import { and, eq, isNotNull } from 'drizzle-orm';
import { compteGmail } from '../connecteurs/google/google.js';
import type { FetchLike } from '../connecteurs/google/oauth.js';
import { connexions } from '../connexions/schema.js';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { loadInstanceSecrets } from '../secrets.js';
import { parcourirBoite } from './boite-mail.js';
import { majConformite, majHistorique } from './integration.js';
import { baseReponses, baseVivante, type Resultat } from './schema.js';

export class RapprochementImpossible extends Error {}

export type RapportBoite = {
  messages: number;
  contactes: number;
  reponses: number;
  autos: number;
  bounces: number;
  jamaisContactes: number;
};

export type EtatRapprochement = {
  etat: 'en_cours' | 'termine' | 'echec';
  mandat: string;
  depuis: string;
  debut: string;
  lus: number;
  total: number;
  rapport?: RapportBoite;
  erreur?: string;
};

export type RapprochementDeps = { secretsDir: string; fetch?: FetchLike };

// A result already classified by the pilot is never overwritten by what the mailbox suggests.
const CLASSES: (Resultat | null)[] = ['interesse', 'pas_interesse', 'mauvais_interlocuteur'];

const jobs = new Map<string, EtatRapprochement>();
export const etatRapprochement = (instanceId: string): EtatRapprochement | null =>
  jobs.get(instanceId) ?? null;

export async function verifierMessagerie(db: Executor, mandat: Instance): Promise<void> {
  const [c] = await withInstance(db, mandat.id, (tx) =>
    tx
      .select({ fournisseur: connexions.fournisseur, etat: connexions.etat })
      .from(connexions)
      .where(and(eq(connexions.instanceId, mandat.id), eq(connexions.kind, 'messagerie'))),
  );
  if (!c || c.etat === 'non_configuree' || c.fournisseur !== 'gmail')
    throw new RapprochementImpossible(
      `La boîte Gmail de ${mandat.nom} n'est pas connectée : Paramètres > Connexions.`,
    );
}

// Reads the mandate's mailbox once, from `depuis`, and updates every record of the base whose
// address appears in it. Read-only on the mailbox.
export async function rapprocherBoite(
  db: Executor,
  deps: RapprochementDeps,
  base: Instance,
  mandat: Instance,
  depuis: Date,
  progres?: (lus: number, total: number) => void,
): Promise<RapportBoite> {
  await verifierMessagerie(db, mandat);
  const ctx = {
    instance: mandat,
    secrets: await loadInstanceSecrets(deps.secretsDir, mandat.slug),
  };
  const options = deps.fetch ? { fetch: deps.fetch } : {};
  const compte = await compteGmail(ctx, options);

  const fiches = await withInstance(db, base.id, (tx) =>
    tx
      .select({ id: baseVivante.id, email: baseVivante.email, resultat: baseVivante.resultat })
      .from(baseVivante)
      .where(and(eq(baseVivante.instanceId, base.id), isNotNull(baseVivante.email))),
  );
  const parEmail = new Map(fiches.map((f) => [(f.email ?? '').toLowerCase(), f]));
  const { resume, messages } = await parcourirBoite(ctx, depuis, new Set(parEmail.keys()), compte, {
    ...options,
    progres,
  });

  const rapport: RapportBoite = {
    messages,
    contactes: 0,
    reponses: 0,
    autos: 0,
    bounces: 0,
    jamaisContactes: 0,
  };
  const contactes = new Set<string>();
  for (const [email, r] of resume) {
    const fiche = parEmail.get(email);
    if (!fiche) continue;
    const vraies = r.reponses.filter((x) => !x.auto);
    const contacte = r.envoyes > 0 || r.recus > 0;
    if (r.envoyes > 0) rapport.contactes++;
    if (contacte) contactes.add(email);
    if (vraies.length > 0) rapport.reponses++;
    else if (r.reponses.length > 0) rapport.autos++;
    if (r.bounce) rapport.bounces++;

    await withInstance(db, base.id, async (tx) => {
      if (contacte) {
        const dernier = [r.dernierEnvoi, r.dernierRecu]
          .filter((d): d is Date => d !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        const suggere: Resultat | null =
          vraies.length > 0 ? 'repondu' : r.reponses.length > 0 ? 'reponse_auto' : 'sans_reponse';
        await majHistorique(tx, base.id, fiche.id, {
          dernierContactLe: dernier ?? null,
          dernierContactCanal: 'email',
          mandatContacteur: mandat.nom,
          nbContacts: r.envoyes,
          // A pass over a shorter period must not downgrade what an earlier one established.
          resultat:
            CLASSES.includes(fiche.resultat) ||
            fiche.resultat === 'repondu' ||
            (suggere === 'sans_reponse' && fiche.resultat)
              ? undefined
              : suggere,
        });
      }
      if (r.bounce) await majConformite(tx, base.id, fiche.id, { emailInvalide: true });
      for (const rep of r.reponses)
        await tx
          .insert(baseReponses)
          .values({
            instanceId: base.id,
            ficheId: fiche.id,
            mandat: mandat.nom,
            messageId: rep.messageId,
            recuLe: rep.date,
            objet: rep.objet,
            extrait: rep.extrait,
            auto: rep.auto,
            // An automatic reply needs no judgment: only the others wait for Claude.
            classe: rep.auto ? 'reponse_auto' : null,
            validee: rep.auto,
          })
          .onConflictDoNothing();
    });
  }
  rapport.jamaisContactes = fiches.filter(
    (f) => !contactes.has((f.email ?? '').toLowerCase()),
  ).length;
  return rapport;
}

// Starts the pass in the background (a mailbox of thousands of messages takes minutes) and keeps
// its progress in memory: one pass at a time per base.
export function lancerRapprochement(
  db: Executor,
  deps: RapprochementDeps,
  base: Instance,
  mandat: Instance,
  depuis: Date,
): EtatRapprochement {
  if (jobs.get(base.id)?.etat === 'en_cours')
    throw new RapprochementImpossible('Un rapprochement est déjà en cours.');
  const etat: EtatRapprochement = {
    etat: 'en_cours',
    mandat: mandat.nom,
    depuis: depuis.toISOString().slice(0, 10),
    debut: new Date().toISOString(),
    lus: 0,
    total: 0,
  };
  jobs.set(base.id, etat);
  void rapprocherBoite(db, deps, base, mandat, depuis, (lus, total) => {
    etat.lus = lus;
    etat.total = total;
  }).then(
    (rapport) => {
      etat.etat = 'termine';
      etat.rapport = rapport;
    },
    (error: unknown) => {
      etat.etat = 'echec';
      etat.erreur = error instanceof Error ? error.message : String(error);
    },
  );
  return etat;
}
