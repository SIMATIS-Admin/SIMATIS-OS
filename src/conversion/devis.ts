import { and, asc, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, entreprises, opportunites } from '../crm/schema.js';
import { changeOpportunite, pipelineSource } from '../crm/pipeline.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import { logEvent } from '../journal/service.js';
import { echapper, paragraphe, salutation } from '../mail/gabarit.js';
import { creerTacheSuivi } from '../pilotage/types-propositions.js';
import { registerPropositionType } from '../propositions/registry.js';
import { propose, type PropositionCtx } from '../propositions/service.js';
import { calculer, DevisRefuse, type ContenuDevis } from './devis-contenu.js';
import { genererPdfDevis } from './devis-pdf.js';
import { formaterNumero, REGLAGES_PAR_DEFAUT, type Reglages } from './devis-parametres.js';
import { devis, devisClauses, devisModeles, devisReglages, type Devis } from './schema.js';

export { DevisRefuse };

// Quotes are SIMATIS's own offer: only the "propre" instance with the devis module has them.
export const devisActif = (instance: Instance) =>
  instance.type === 'propre' && (instance.config.modules ?? []).includes('devis');

const suffixeVersion = /-V\d+$/;
const baseNumero = (numero: string) => numero.replace(suffixeVersion, '');

// Numbers and versions are derived from what already exists: two writers at once would draw the
// same one, so creations of one instance take turns.
const verrouiller = (tx: Tx, instanceId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${instanceId}))`);

const reglagesDe = async (tx: Tx): Promise<Reglages> => {
  const [r] = await tx
    .select()
    .from(devisReglages)
    .where(eq(devisReglages.instanceId, currentInstance));
  return r
    ? {
        numerotation: r.numerotation,
        mentions: r.mentions,
        tvaPct: r.tvaPct,
        validiteJours: r.validiteJours,
        acomptePct: r.acomptePct,
      }
    : REGLAGES_PAR_DEFAUT;
};

async function charger(tx: Tx, id: string): Promise<Devis> {
  if (!z.uuid().safeParse(id).success) throw new DevisRefuse('Devis introuvable');
  const [row] = await tx
    .select()
    .from(devis)
    .where(and(eq(devis.instanceId, currentInstance), eq(devis.id, id)));
  if (!row) throw new DevisRefuse('Devis introuvable');
  return row;
}

// All versions of one quote share its base number; the latest is the one that lives.
async function versionsDe(tx: Tx, numero: string): Promise<Devis[]> {
  const base = baseNumero(numero);
  const rows = await tx
    .select()
    .from(devis)
    .where(and(eq(devis.instanceId, currentInstance), like(devis.numero, `${base}%`)));
  return rows.filter((r) => baseNumero(r.numero) === base).sort((a, b) => b.version - a.version);
}

const enrichir = async (tx: Tx, rows: Devis[]) => {
  const reglages = await reglagesDe(tx);
  const liens = await tx
    .select({
      id: opportunites.id,
      opportunite: opportunites.titre,
      entreprise: entreprises.nom,
      contact: contacts.nom,
    })
    .from(opportunites)
    .leftJoin(
      entreprises,
      and(
        eq(entreprises.id, opportunites.entrepriseId),
        eq(entreprises.instanceId, currentInstance),
      ),
    )
    .leftJoin(
      contacts,
      and(eq(contacts.id, opportunites.contactId), eq(contacts.instanceId, currentInstance)),
    )
    .where(
      and(
        eq(opportunites.instanceId, currentInstance),
        inArray(opportunites.id, [...new Set(rows.map((r) => r.opportuniteId))]),
      ),
    );
  const parId = new Map(liens.map((l) => [l.id, l]));
  return rows.map((r) => ({
    ...r,
    opportunite: parId.get(r.opportuniteId)?.opportunite ?? '',
    entreprise: parId.get(r.opportuniteId)?.entreprise ?? null,
    contact: parId.get(r.opportuniteId)?.contact ?? null,
    totaux: calculer(r, reglages.tvaPct),
    tvaPct: reglages.tvaPct,
    mentions: reglages.mentions,
  }));
};

export async function listerDevis(db: Executor, instance: Instance) {
  return withInstance(db, instance.id, async (tx) => {
    const tous = await tx
      .select()
      .from(devis)
      .where(eq(devis.instanceId, currentInstance))
      .orderBy(desc(devis.createdAt));
    const dernieres = new Map<string, { row: Devis; versions: number }>();
    for (const row of tous) {
      const base = baseNumero(row.numero);
      const vu = dernieres.get(base);
      if (!vu) dernieres.set(base, { row, versions: 1 });
      else {
        vu.versions += 1;
        if (row.version > vu.row.version) vu.row = row;
      }
    }
    const gardes = [...dernieres.values()];
    const enrichis = await enrichir(
      tx,
      gardes.map((g) => g.row),
    );
    return enrichis.map((d, i) => ({ ...d, versions: gardes[i]?.versions ?? 1 }));
  });
}

export async function lireDevis(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, async (tx) => {
    const row = await charger(tx, id);
    const [enrichi] = await enrichir(tx, [row]);
    if (!enrichi) throw new DevisRefuse('Devis introuvable');
    return enrichi;
  });
}

// The OS prepares the quote from the deal; every price is left for the pilot to set. The deal's
// amount is only offered as a suggestion (`prixPropose`).
export async function creerDepuisAffaire(
  db: Executor,
  instance: Instance,
  opportuniteId: string,
  modeleId?: string,
) {
  return withInstance(db, instance.id, async (tx) => {
    await verrouiller(tx, instance.id);
    const [opp] = await tx
      .select()
      .from(opportunites)
      .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.id, opportuniteId)));
    if (!opp) throw new DevisRefuse('Affaire introuvable dans cette instance');
    const source = await pipelineSource(tx);
    const rang = source.etapes.findIndex((etape) => etape.id === opp.etape);
    if (opp.clos || rang < 2) {
      throw new DevisRefuse('Le devis doit être rattaché à une affaire ouverte du Pipeline');
    }
    const existants = await tx
      .select()
      .from(devis)
      .where(and(eq(devis.instanceId, currentInstance), eq(devis.opportuniteId, opportuniteId)));
    const dernier = existants.sort((a, b) => b.version - a.version)[0];
    if (dernier) return { devis: dernier, existant: true };

    const reglages = await reglagesDe(tx);
    const bibliotheque = await tx
      .select()
      .from(devisClauses)
      .where(and(eq(devisClauses.instanceId, currentInstance), eq(devisClauses.parDefaut, true)))
      .orderBy(asc(devisClauses.ordre), asc(devisClauses.createdAt));
    // Without a library, a new quote starts from the last quote's conditions.
    const [recent] = await tx
      .select({ clauses: devis.clauses })
      .from(devis)
      .where(eq(devis.instanceId, currentInstance))
      .orderBy(desc(devis.createdAt))
      .limit(1);
    const clauses = bibliotheque.length
      ? bibliotheque.map((c) => ({ titre: c.titre, texte: c.texte, active: true }))
      : (recent?.clauses ?? []);
    let modele: typeof devisModeles.$inferSelect | undefined;
    if (modeleId) {
      [modele] = await tx
        .select()
        .from(devisModeles)
        .where(and(eq(devisModeles.instanceId, currentInstance), eq(devisModeles.id, modeleId)));
      if (!modele) throw new DevisRefuse('Modèle de mission introuvable');
    }
    const premieres = await tx
      .select({ id: devis.id })
      .from(devis)
      .where(and(eq(devis.instanceId, currentInstance), eq(devis.version, 1)));
    const numero =
      instance.type === 'prospect'
        ? `DEMO-${String(premieres.length + 1).padStart(3, '0')}`
        : formaterNumero(reglages.numerotation, new Date().getFullYear(), premieres.length + 1);
    const recurrente = opp.modeFacturation === 'recurrent';
    const lignes = modele?.lignes.length
      ? modele.lignes.map((l) => ({
          ...l,
          prixUnitaire: null,
          // One line can carry the deal's amount as a suggestion; several lines cannot share it.
          prixPropose: modele.lignes.length === 1 ? (opp.montant ?? null) : null,
        }))
      : [
          {
            libelle: opp.titre,
            unite: recurrente ? ('mois' as const) : ('forfait' as const),
            quantite: recurrente ? opp.dureeEngagementMois : 1,
            prixUnitaire: null,
            prixPropose: opp.montant ?? null,
          },
        ];
    const [row] = await tx
      .insert(devis)
      .values({
        instanceId: currentInstance,
        opportuniteId,
        numero,
        titre: opp.titre,
        contexte: modele?.contexte ?? '',
        objectifs: modele?.objectifs ?? '',
        inclus: modele?.inclus ?? '',
        exclu: modele?.exclu ?? '',
        livrables: modele?.livrables ?? '',
        duree: modele?.duree ?? '',
        validiteJours: reglages.validiteJours,
        acomptePct: reglages.acomptePct,
        clauses,
        lignes,
      })
      .returning();
    if (!row) throw new Error('Devis non créé');
    await logEvent(tx, {
      acteur: 'os',
      action: `Devis préparé : ${numero} (prix à fixer)`,
      niveau: 'L1',
    });
    return { devis: row, existant: false };
  });
}

export async function modifierContenu(
  db: Executor,
  instance: Instance,
  id: string,
  contenu: ContenuDevis,
) {
  return withInstance(db, instance.id, async (tx) => {
    const current = await charger(tx, id);
    if (current.statut !== 'brouillon') throw new DevisRefuse('Devis déjà validé : non modifiable');
    const [row] = await tx
      .update(devis)
      .set({ ...contenu, updatedAt: new Date() })
      .where(and(eq(devis.id, id), eq(devis.statut, 'brouillon')))
      .returning();
    // Validated in between by another request: the draft is no longer ours to write.
    if (!row) throw new DevisRefuse('Devis déjà validé : non modifiable');
    return row;
  });
}

export async function validerDevis(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, async (tx) => {
    const current = await charger(tx, id);
    if (current.statut !== 'brouillon') throw new DevisRefuse('Devis déjà validé');
    if (calculer(current).prixManquant) throw new DevisRefuse("Fixez tous les prix d'abord");
    if (!current.inclus.trim()) throw new DevisRefuse('Précisez le périmètre inclus');
    if (!current.titre.trim()) throw new DevisRefuse('Donnez un intitulé à la mission');
    if (current.lignes.some((l) => !l.libelle.trim()))
      throw new DevisRefuse('Chaque ligne de prix doit avoir un libellé');
    const [row] = await tx
      .update(devis)
      .set({ statut: 'valide', updatedAt: new Date() })
      .where(and(eq(devis.id, id), eq(devis.statut, 'brouillon')))
      .returning();
    if (!row) throw new DevisRefuse('Devis déjà validé');
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Devis validé et prix fixés : ${current.numero}`,
      niveau: 'L1',
    });
    return row;
  });
}

// A validated quote never changes: a new version is a fresh draft copied from the latest one.
export async function nouvelleVersion(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, async (tx) => {
    await verrouiller(tx, instance.id);
    const source = await charger(tx, id);
    if (source.statut === 'brouillon')
      throw new DevisRefuse('Ce devis est encore un brouillon : modifiez-le directement');
    const [derniere] = await versionsDe(tx, source.numero);
    if (derniere?.id !== source.id)
      throw new DevisRefuse('Une version plus récente existe déjà : ouvrez-la');
    const version = source.version + 1;
    const numero = `${baseNumero(source.numero)}-V${version}`;
    const [row] = await tx
      .insert(devis)
      .values({
        instanceId: currentInstance,
        opportuniteId: source.opportuniteId,
        numero,
        version,
        titre: source.titre,
        contexte: source.contexte,
        objectifs: source.objectifs,
        inclus: source.inclus,
        exclu: source.exclu,
        livrables: source.livrables,
        duree: source.duree,
        debut: source.debut,
        remisePct: source.remisePct,
        acomptePct: source.acomptePct,
        frais: source.frais,
        validiteJours: source.validiteJours,
        clauses: source.clauses,
        lignes: source.lignes,
      })
      .returning();
    if (!row) throw new Error('Version non créée');
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Nouvelle version du devis : ${numero}`,
      niveau: 'L1',
    });
    return row;
  });
}

const transmission = z.object({ devisId: z.uuid(), numero: z.string(), montant: z.number() });

// Sending a quote commits SIMATIS to the client: it always waits for the pilot's explicit
// validation (action « transmettre », locked at L2).
registerPropositionType({
  type: 'devis.transmettre',
  action: 'transmettre',
  schema: transmission,
  apply: async (tx, c, ctx) => {
    const current = await charger(tx, c.devisId);
    if (current.statut !== 'valide') throw new DevisRefuse('Le devis doit être validé avant envoi');
    const envoye = new Date();
    const validite = new Date(envoye.getTime() + current.validiteJours * 864e5)
      .toISOString()
      .slice(0, 10);
    await tx
      .update(devis)
      .set({ statut: 'transmis', envoyeLe: envoye, validite, updatedAt: envoye })
      .where(eq(devis.id, c.devisId));
    // A sent quote moves an open native deal to "proposition" unless it is already further
    // (a mirrored CRM keeps its own stage ids and is left alone).
    await tx
      .update(opportunites)
      .set({ etape: 'proposition', updatedAt: envoye })
      .where(
        and(
          eq(opportunites.instanceId, currentInstance),
          eq(opportunites.id, current.opportuniteId),
          isNull(opportunites.clos),
          inArray(opportunites.etape, ['detection', 'prospection', 'qualification']),
        ),
      );
    const [lien] = await tx
      .select({ contactId: contacts.id, nom: contacts.nom, email: contacts.email })
      .from(opportunites)
      .leftJoin(
        contacts,
        and(eq(contacts.id, opportunites.contactId), eq(contacts.instanceId, currentInstance)),
      )
      .where(
        and(
          eq(opportunites.instanceId, currentInstance),
          eq(opportunites.id, current.opportuniteId),
        ),
      );
    // The reminder first (undoable), the mail last (a real draft cannot be taken back). Neither
    // may undo the quote's own change of state: a failure is reported in the result.
    let relance = '';
    try {
      await tx.transaction((sp) =>
        creerTacheSuivi(
          sp,
          ctx,
          {
            titre: `Relancer le devis ${current.numero}`,
            canal: 'email',
            echeance: new Date(envoye.getTime() + DELAI_RELANCE_JOURS * 864e5),
            contactId: lien?.contactId ?? null,
            opportuniteId: current.opportuniteId,
          },
          `Devis ${current.numero} envoyé sans réponse depuis ${DELAI_RELANCE_JOURS} jours.`,
        ),
      );
    } catch (error) {
      relance = ` Relance à J+${DELAI_RELANCE_JOURS} non créée (${error instanceof Error ? error.message : String(error)}).`;
    }
    const message =
      (await brouillonDuDevis(tx, ctx, current, lien?.email ?? null, lien?.nom ?? null)) + relance;
    return { simulation: false, statut: 'transmis', message };
  },
});

const DELAI_RELANCE_JOURS = 10;

// The mail is only ever a draft in the instance's mailbox: the pilot rereads and sends it. A
// missing address or mailbox never blocks the quote, the message says what was left undone.
async function brouillonDuDevis(
  tx: Tx,
  ctx: { instance: Instance; deps: ConnexionDeps },
  d: Devis,
  email: string | null,
  nomContact: string | null,
): Promise<string> {
  if (!email) {
    return 'Aucune adresse pour le contact de l’affaire : brouillon non créé, le PDF reste téléchargeable depuis le devis.';
  }
  const validite = d.validite ? new Date(d.validite).toLocaleDateString('fr-FR') : null;
  const html = [
    paragraphe(salutation(nomContact)),
    paragraphe(
      `Comme convenu, vous trouverez ci-joint notre proposition « ${echapper(d.titre)} » (devis ${echapper(d.numero)})${validite ? `, valable jusqu’au ${validite}` : ''}.`,
    ),
    paragraphe('Je reste à votre disposition pour en parler et répondre à vos questions.'),
  ].join('\n');
  try {
    const [enrichi] = await enrichir(tx, [d]);
    if (!enrichi) throw new DevisRefuse('Devis introuvable');
    const pdf = await genererPdfDevis({
      ...enrichi,
      createdAt: enrichi.createdAt,
      entreprise: enrichi.entreprise,
    });
    // Savepoint: a mailbox error must not undo the quote's own change of state.
    const resultat = await tx.transaction((sp) =>
      writeVia(
        sp,
        ctx.instance,
        'messagerie',
        {
          op: 'draft.create',
          data: {
            to: email,
            subject: `Devis ${d.numero} : ${d.titre}`,
            html,
            pieces: [
              {
                nom: `devis-${d.numero.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`,
                typeMime: 'application/pdf',
                base64: pdf.toString('base64'),
              },
            ],
          },
        },
        ctx.deps,
      ),
    );
    return resultat.simulation
      ? 'Brouillon Gmail simulé (écritures réelles désactivées).'
      : `Brouillon Gmail créé pour ${email}, avec le PDF : à relire et à envoyer.`;
  } catch (error) {
    return `Brouillon non créé (${error instanceof Error ? error.message : String(error)}) : le PDF reste téléchargeable depuis le devis.`;
  }
}

export async function demanderTransmission(db: Executor, ctx: PropositionCtx, id: string) {
  return withInstance(db, ctx.instance.id, async (tx) => {
    const current = await charger(tx, id);
    if (current.statut !== 'valide')
      throw new DevisRefuse('Validez le devis avant de le transmettre');
    return propose(tx, ctx, {
      type: 'devis.transmettre',
      contenu: { devisId: id, numero: current.numero, montant: calculer(current).ht },
      auteur: 'os',
    });
  });
}

const issueSchema = z.object({
  issue: z.enum(['accepte', 'refuse']),
  motif: z.string().trim().max(200).nullish(),
});
export type IssueDevis = z.infer<typeof issueSchema>;
export const issueDevisSchema = issueSchema;

// The client's answer: the affair follows (won or lost, through the same path as the Pipeline, so a
// mirrored CRM is written, simulated or refused exactly like a drag in the board).
export async function conclureDevis(
  db: Executor,
  instance: Instance,
  id: string,
  { issue, motif }: IssueDevis,
  deps: ConnexionDeps,
) {
  const courant = await lireDevis(db, instance, id);
  if (courant.statut !== 'transmis')
    throw new DevisRefuse('Seul un devis envoyé peut être accepté ou refusé');
  // Claim the quote first (atomic), so two simultaneous answers cannot both reach the affair.
  const row = await withInstance(db, instance.id, async (tx) => {
    const [pris] = await tx
      .update(devis)
      .set({ statut: issue, updatedAt: new Date() })
      .where(and(eq(devis.id, id), eq(devis.statut, 'transmis')))
      .returning();
    return pris;
  });
  if (!row) throw new DevisRefuse('Devis déjà conclu');
  try {
    const fait = await changeOpportunite(
      db,
      instance,
      courant.opportuniteId,
      issue === 'accepte' ? { clos: 'gagne' } : { clos: 'perdu', motif: motif ?? null },
      deps,
    );
    if (!fait) throw new DevisRefuse('Affaire introuvable dans cette instance');
  } catch (error) {
    // The affair refused (read-only CRM…): the quote goes back to « envoyé ».
    await withInstance(db, instance.id, (tx) =>
      tx.update(devis).set({ statut: 'transmis' }).where(eq(devis.id, id)),
    );
    throw error;
  }
  return withInstance(db, instance.id, async (tx) => {
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Devis ${row.numero} ${issue === 'accepte' ? 'accepté' : 'refusé'}`,
      niveau: 'L1',
    });
    return row;
  });
}
