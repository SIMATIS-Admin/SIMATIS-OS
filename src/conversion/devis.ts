import { and, desc, eq, inArray, isNull, like } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, entreprises, opportunites } from '../crm/schema.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { registerPropositionType } from '../propositions/registry.js';
import { propose, type PropositionCtx } from '../propositions/service.js';
import { calculer, type ContenuDevis } from './devis-contenu.js';
import { devis, type Devis } from './schema.js';

export class DevisRefuse extends Error {}

// Quotes are SIMATIS's own offer: only the "propre" instance with the devis module has them.
export const devisActif = (instance: Instance) =>
  instance.type === 'propre' && (instance.config.modules ?? []).includes('devis');

const suffixeVersion = /-V\d+$/;
const baseNumero = (numero: string) => numero.replace(suffixeVersion, '');

async function charger(tx: Tx, id: string): Promise<Devis> {
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
    totaux: calculer(r),
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
export async function creerDepuisAffaire(db: Executor, instance: Instance, opportuniteId: string) {
  return withInstance(db, instance.id, async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunites)
      .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.id, opportuniteId)));
    if (!opp) throw new DevisRefuse('Opportunité introuvable dans cette instance');
    const existants = await tx
      .select()
      .from(devis)
      .where(and(eq(devis.instanceId, currentInstance), eq(devis.opportuniteId, opportuniteId)));
    const dernier = existants.sort((a, b) => b.version - a.version)[0];
    if (dernier) return { devis: dernier, existant: true };

    const [recent] = await tx
      .select({ clauses: devis.clauses })
      .from(devis)
      .where(eq(devis.instanceId, currentInstance))
      .orderBy(desc(devis.createdAt))
      .limit(1);
    const premieres = await tx
      .select({ id: devis.id })
      .from(devis)
      .where(and(eq(devis.instanceId, currentInstance), eq(devis.version, 1)));
    const n = premieres.length;
    const prefixe = instance.type === 'prospect' ? 'DEMO' : `DEV-${new Date().getFullYear()}`;
    const numero = `${prefixe}-${String(n + 1).padStart(3, '0')}`;
    const recurrente = opp.modeFacturation === 'recurrent';
    const [row] = await tx
      .insert(devis)
      .values({
        instanceId: currentInstance,
        opportuniteId,
        numero,
        titre: opp.titre,
        clauses: recent?.clauses ?? [],
        lignes: [
          {
            libelle: opp.titre,
            unite: recurrente ? 'mois' : 'forfait',
            quantite: recurrente ? opp.dureeEngagementMois : 1,
            prixUnitaire: null,
            prixPropose: opp.montant ?? null,
          },
        ],
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
      .where(eq(devis.id, id))
      .returning();
    return row ?? current;
  });
}

export async function validerDevis(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, async (tx) => {
    const current = await charger(tx, id);
    if (current.statut !== 'brouillon') throw new DevisRefuse('Devis déjà validé');
    if (calculer(current).prixManquant) throw new DevisRefuse("Fixez tous les prix d'abord");
    if (!current.inclus.trim()) throw new DevisRefuse('Précisez le périmètre inclus');
    const [row] = await tx
      .update(devis)
      .set({ statut: 'valide', updatedAt: new Date() })
      .where(eq(devis.id, id))
      .returning();
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Devis validé et prix fixés : ${current.numero}`,
      niveau: 'L1',
    });
    return row ?? current;
  });
}

// A validated quote never changes: a new version is a fresh draft copied from the latest one.
export async function nouvelleVersion(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, async (tx) => {
    const source = await charger(tx, id);
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
  apply: async (tx, c) => {
    const current = await charger(tx, c.devisId);
    if (current.statut !== 'valide') throw new DevisRefuse('Le devis doit être validé avant envoi');
    const envoye = new Date();
    const validite = new Date(envoye.getTime() + current.validiteJours * 864e5).toISOString().slice(0, 10);
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
    return { simulation: false, statut: 'transmis' };
  },
});

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
