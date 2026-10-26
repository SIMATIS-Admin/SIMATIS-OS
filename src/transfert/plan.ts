import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { instances } from '../instances/schema.js';
import { journal } from '../journal/schema.js';
import { sujets } from '../inbox/schema.js';
import { cle, libelleDe, lignesOu, lire, type Ligne } from './acces.js';
import { estMiroir, EXTERNES, REGISTRE } from './registre.js';
import type { Apercu, Exclusions, Mode, Noeud, Ref, TypeObjet } from './types.js';

export class TransfertRefuse extends Error {}
export class RacineIntrouvable extends Error {}

export type DemandeTransfert = {
  instanceOrigine: string;
  cible: string;
  racine: Ref;
  exclusions: Exclusions;
};

type Voisin = Ref & { obligatoire: boolean; sens: 'sortant' | 'entrant' | 'liaison' };

// Every object linked to one object, in both directions: link columns and many-to-many tables.
export async function voisinsDe(
  db: Executor,
  instanceId: string,
  type: TypeObjet,
  ligne: Ligne,
): Promise<Voisin[]> {
  const res: Voisin[] = [];
  const obligatoires = REGISTRE[type].obligatoires;
  for (const l of REGISTRE[type].liens) {
    const v = ligne[l.colonne];
    if (typeof v === 'string')
      res.push({ type: l.vers, id: v, obligatoire: false, sens: 'sortant' });
  }
  for (const [u, entree] of Object.entries(REGISTRE) as [
    TypeObjet,
    (typeof REGISTRE)[TypeObjet],
  ][]) {
    for (const l of entree.liens.filter((x) => x.vers === type)) {
      for (const r of await lignesOu(db, entree.table, instanceId, l.colonne, ligne.id)) {
        res.push({
          type: u,
          id: r.id as string,
          obligatoire: obligatoires.includes(u),
          sens: 'entrant',
        });
      }
    }
    for (const l of entree.liaisons) {
      const [monCote, autreCote, autreType] =
        l.proprietaire === type
          ? [l.colProprietaire, l.colCible, l.cible]
          : l.cible === type
            ? [l.colCible, l.colProprietaire, l.proprietaire]
            : [null, null, null];
      if (!monCote || !autreCote || !autreType) continue;
      for (const r of await lignesOu(db, l.table, instanceId, monCote, ligne.id)) {
        res.push({
          type: autreType,
          id: r[autreCote] as string,
          obligatoire: obligatoires.includes(autreType),
          sens: 'liaison',
        });
      }
    }
  }
  return res;
}

export async function planifierTransfert(db: Executor, p: DemandeTransfert): Promise<Apercu> {
  const [origine] = await db.select().from(instances).where(eq(instances.id, p.instanceOrigine));
  if (!origine) throw new TransfertRefuse("Instance d'origine inconnue.");
  const [cible] = await db.select().from(instances).where(eq(instances.id, p.cible));
  if (!cible) throw new TransfertRefuse('Instance cible inconnue.');
  if (cible.statut !== 'actif') throw new TransfertRefuse('Instance cible archivée.');
  // A demo holds fictive data only and is wiped on reset: no real data in, no fictive data out.
  if (origine.type === 'prospect' || cible.type === 'prospect') {
    throw new TransfertRefuse('Une démonstration ne reçoit ni ne donne de données réelles.');
  }
  if (cible.id === origine.id) throw new TransfertRefuse("L'objet est déjà dans cette instance.");

  const racine = await lire(db, p.racine.type, origine.id, p.racine.id);
  if (!racine) throw new RacineIntrouvable("Objet introuvable dans l'instance d'origine.");

  const exclus = new Set(p.exclusions.map(cle));
  const racineNative = !estMiroir(p.racine.type, racine);
  // A mirror root brings everything as copies; a native one moves its native objects.
  const modeDe = (type: TypeObjet, l: Ligne): Mode =>
    racineNative && !estMiroir(type, l) ? 'deplace' : 'copie';

  type Item = { noeud: Noeud; ligne: Ligne; voisins: Voisin[] };
  // An offered object only brings the objects that follow it without a choice.
  const restreint = (i: Item) => !i.noeud.obligatoire;
  const items = new Map<string, Item>();
  const lignes = new Map<string, Ligne | null>();
  const charger = async (r: Ref) => {
    const k = cle(r);
    if (!lignes.has(k)) lignes.set(k, await lire(db, r.type, origine.id, r.id));
    return lignes.get(k) ?? null;
  };

  const ajouter = async (r: Ref, obligatoire: boolean): Promise<Item | null> => {
    const ligne = await charger(r);
    if (!ligne) return null;
    const item: Item = {
      noeud: { ...r, libelle: libelleDe(r.type, ligne), mode: modeDe(r.type, ligne), obligatoire },
      ligne,
      voisins: await voisinsDe(db, origine.id, r.type, ligne),
    };
    items.set(cle(r), item);
    return item;
  };

  const premier = await ajouter(p.racine, true);
  const file: Item[] = premier ? [premier] : [];
  // The root and the objects that follow without a choice bring all their neighbours; an offered
  // one brings only its own obligatory ones, so the sub-graph never swallows a whole connected
  // component. Unticking only works on offered objects.
  while (file.length) {
    const item = file.shift() as Item;
    for (const v of item.voisins) {
      const k = cle(v);
      if (items.has(k)) continue;
      if (exclus.has(k) && !v.obligatoire) continue;
      if (restreint(item) && !v.obligatoire) continue;
      const nouveau = await ajouter(v, v.obligatoire);
      if (nouveau) file.push(nouveau);
    }
  }

  const retires = new Set<string>();
  for (const item of items.values()) {
    for (const v of item.voisins) {
      if (items.has(cle(v))) continue;
      const autre = await charger(v);
      if (!autre) continue;
      const nomAutre = libelleDe(v.type, autre);
      const moi = item.noeud;
      if (v.sens === 'entrant') {
        // A copy leaves its original behind, so whoever points at the original is untouched.
        if (moi.mode === 'deplace')
          retires.add(`« ${nomAutre} » (reste sur place) perd son lien vers « ${moi.libelle} »`);
      } else {
        retires.add(`« ${moi.libelle} » perd son lien vers « ${nomAutre} »`);
      }
    }
  }

  // Tables outside the registry that point at an object about to leave.
  for (const { noeud } of items.values()) {
    if (noeud.mode !== 'deplace') continue;
    for (const e of EXTERNES.filter((x) => x.vers === noeud.type)) {
      const lignes = await lignesOu(db, e.table, origine.id, e.colonne, noeud.id);
      if (!lignes.length) continue;
      if (!e.nullable) {
        throw new TransfertRefuse(
          `« ${noeud.libelle} » a un ${e.nom} lié : il ne peut pas être transféré.`,
        );
      }
      retires.add(
        `${lignes.length} ${e.nom} (reste sur place) perd son lien vers « ${noeud.libelle} »`,
      );
    }
  }

  const avertissements: string[] = [];
  for (const { noeud, ligne } of items.values()) {
    const deLOs = typeof ligne.eventId === 'string' && ligne.eventId.startsWith('os:');
    if (noeud.type === 'rdv' && noeud.mode === 'copie' && !deLOs) {
      avertissements.push(`Le rendez-vous « ${noeud.libelle} » ne sera plus lié à l'agenda.`);
    }
    if (noeud.type === 'sujet') {
      if (ligne.propositionId) {
        avertissements.push(`L'entrée « ${noeud.libelle} » perd son lien avec une proposition.`);
      }
      if (noeud.mode === 'deplace' && typeof ligne.sourceId === 'string') {
        const [pris] = await db
          .select({ id: sujets.id })
          .from(sujets)
          .where(
            and(
              eq(sujets.instanceId, cible.id),
              eq(sujets.source, ligne.source),
              eq(sujets.sourceId, ligne.sourceId),
            ),
          );
        if (pris) {
          avertissements.push(
            `La clé de l'entrée « ${noeud.libelle} » existe déjà dans la cible : elle sera suffixée.`,
          );
        }
      }
    }
  }

  const noeuds = [...items.values()].map((i) => i.noeud);
  return {
    racine: noeuds[0] as Noeud,
    noeuds,
    liensRetires: [...retires],
    avertissements,
    copieExistante:
      noeuds[0]?.mode === 'copie' ? await copieExistante(db, origine.id, cible.id, p.racine) : null,
  };
}

// The target's journal remembers every copy made into it (see executerTransfert).
async function copieExistante(
  db: Executor,
  origine: string,
  cible: string,
  racine: Ref,
): Promise<Ref | null> {
  const motif = JSON.stringify({
    copies: [{ type: racine.type, origineInstance: origine, origineId: racine.id }],
  });
  const lignes = await db
    .select({ details: journal.details })
    .from(journal)
    .where(
      and(
        eq(journal.instanceId, cible),
        eq(journal.action, 'transfert.copie'),
        sql`${journal.details} @> ${motif}::jsonb`,
      ),
    );
  for (const l of lignes) {
    const copies = (l.details as { copies?: Record<string, string>[] }).copies ?? [];
    const c = copies.find(
      (x) => x.type === racine.type && x.origineInstance === origine && x.origineId === racine.id,
    );
    if (c?.copieId) return { type: racine.type, id: c.copieId };
  }
  return null;
}
