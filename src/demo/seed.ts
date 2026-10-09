import { contacts, entreprises, opportunites, taches, type Qualification } from '../crm/schema.js';
import type { Database, Tx } from '../db.js';
import { instances, type InstanceType } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { propositions } from '../propositions/schema.js';
import fixtures from './fixtures.json' with { type: 'json' };

type Fixture = (typeof fixtures)[number];

// Calendar day in Paris, `days` from now, as YYYY-MM-DD.
export function parisDay(days: number, now = new Date()): string {
  const shifted = new Date(now.getTime() + days * 864e5);
  return shifted.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
}

// Fills one instance with the mockup's fictive companies, contacts, deals and tasks. Dates are
// offsets from today, so the demo always looks current.
export async function loadDemoData(tx: Tx, instanceId: string, f: Fixture, now = new Date()) {
  const ref = new Map<string, string>();
  const id = (key: string | null) => (key ? (ref.get(key) ?? null) : null);

  for (const e of f.entreprises) {
    const [row] = await tx
      .insert(entreprises)
      .values({
        instanceId,
        nom: e.nom,
        secteur: e.secteur,
        ville: e.ville,
        taille: e.taille,
        domaine: e.domaine,
      })
      .returning({ id: entreprises.id });
    if (row) ref.set(e.ref, row.id);
  }
  for (const c of f.contacts) {
    const [row] = await tx
      .insert(contacts)
      .values({
        instanceId,
        entrepriseId: id(c.entreprise),
        nom: c.nom,
        fonction: c.fonction,
        email: c.email,
        role: c.role,
      })
      .returning({ id: contacts.id });
    if (row) ref.set(c.ref, row.id);
  }
  for (const o of f.opportunites) {
    const [row] = await tx
      .insert(opportunites)
      .values({
        instanceId,
        entrepriseId: id(o.entreprise),
        contactId: id(o.contact),
        titre: o.titre,
        etape: o.etape,
        montant: o.montant,
        echeance: o.echeanceJours === null ? null : parisDay(o.echeanceJours, now),
        clos: o.clos as 'gagne' | 'perdu' | null,
        motif: o.motif,
        origine: o.origine,
        qualification: o.qualification as Qualification | null,
        potentiel: o.potentiel,
        faisabilite: o.faisabilite,
        prochaineEtape: o.prochaineEtape,
      })
      .returning({ id: opportunites.id });
    if (row) ref.set(o.ref, row.id);
  }
  for (const p of f.propositions) {
    const c = p.contenu as Record<string, unknown>;
    const contenu =
      p.type === 'email.brouillon'
        ? {
            to: c.to,
            objet: c.objet,
            corps: c.corps,
            contactId: id(c.contact as string | null),
            origine: c.origine,
            controles: c.controles,
          }
        : p.type === 'crm.tache'
          ? {
              titre: c.titre,
              detail: c.detail,
              canal: c.canal,
              echeance:
                typeof c.echeanceJours === 'number'
                  ? new Date(`${parisDay(c.echeanceJours, now)}T10:00:00Z`).toISOString()
                  : null,
              contactId: id(c.contact as string | null),
              origine: c.origine,
            }
          : { titre: c.titre, texte: c.texte, destination: c.destination, origine: c.origine };
    await tx.insert(propositions).values({
      instanceId,
      type: p.type,
      contenu,
      auteur: 'os',
      niveau: p.niveau as 'L0' | 'L1' | 'L2' | 'L3',
    });
  }
  for (const t of f.taches) {
    const echeance =
      t.echeanceJours === null ? null : new Date(`${parisDay(t.echeanceJours, now)}T10:00:00Z`);
    await tx.insert(taches).values({
      instanceId,
      opportuniteId: id(t.opportunite),
      contactId: id(t.contact),
      titre: t.titre,
      canal: t.canal as 'email' | 'appel' | 'tache',
      echeance,
      faitAt: t.fait ? echeance : null,
    });
  }
}

// Loads the mockup's fictive instances, only into an empty database: real instances are never touched.
export async function seedDemoIfEmpty(db: Database): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: instances.id }).from(instances).limit(1);
    if (existing) return false;

    for (const f of fixtures) {
      const instance = await createInstance(tx, {
        slug: f.slug,
        nom: f.nom,
        type: f.type as InstanceType,
        config: f.config,
      });
      await loadDemoData(tx, instance.id, f);
    }
    return true;
  });
}
