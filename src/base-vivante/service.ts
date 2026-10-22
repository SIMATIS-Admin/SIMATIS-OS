import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Database, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import {
  CHAMPS_CIBLES,
  memoireDe,
  proposerCorrespondance,
  trouverEntete,
  type ChampCible,
  type Correspondance,
  type MemoireColonnes,
} from './colonnes.js';
import type { Zone } from './completude.js';
import { integrerFiches } from './integration.js';
import { lireFichier, lireTexte, FichierIllisible, type Feuille } from './lecture.js';
import {
  baseCorrespondances,
  baseImports,
  baseLignesBrutes,
  baseVivante,
  type BaseImport,
  type StatutLigne,
} from './schema.js';
import { calculerLigne, calculerLignes, type LigneCalculee } from './traitement.js';

export class ImportIntrouvable extends Error {}
export class ImportRefuse extends Error {}

const LOT = 500;
const LIGNES_MAX = 200_000;

export type NouvelImport = {
  nomFichier: string;
  contenu?: Buffer;
  texte?: string;
  provenance: string;
  mandat?: string | null;
  collecteLe?: string | null;
};

export type Compteurs = {
  total: number;
  prospectables: number;
  aEnrichir: number;
  sousMinimum: number;
  doublonsInternes: number;
  integrees: number;
};

export type LigneApercu = {
  numero: number;
  statut: StatutLigne;
  zone: Zone | null;
  raison: string | null;
  avertissements: string[];
  fiche: LigneCalculee['fiche'];
  brut: string[];
};

export type ApercuImport = {
  id: string;
  nomFichier: string;
  feuille: string;
  provenance: string;
  mandat: string | null;
  collecteLe: string | null;
  statut: BaseImport['statut'];
  creeLe: Date;
  entetes: string[];
  correspondance: Correspondance;
  inconnues: number[];
  echantillon: string[][];
  compteurs: Compteurs;
  lignes: LigneApercu[];
  rapport: BaseImport['rapport'];
};

const vide = (n: number) => Array.from({ length: n }, () => '');

async function insererLignes(
  tx: Tx,
  instanceId: string,
  importId: string,
  lignes: LigneCalculee[],
): Promise<void> {
  for (let i = 0; i < lignes.length; i += LOT) {
    await tx.insert(baseLignesBrutes).values(
      lignes.slice(i, i + LOT).map((l) => ({
        instanceId,
        importId,
        numero: l.numero,
        brut: l.brut,
        complements: l.complements,
        fiche: l.fiche,
        statut: l.statut,
        zone: l.zone,
        raison: l.raison,
        avertissements: l.avertissements,
      })),
    );
  }
}

async function memoireDeSource(tx: Tx, instanceId: string, provenance: string) {
  const [ligne] = await tx
    .select({ memoire: baseCorrespondances.memoire })
    .from(baseCorrespondances)
    .where(
      and(
        eq(baseCorrespondances.instanceId, instanceId),
        eq(baseCorrespondances.provenance, provenance),
      ),
    );
  return ligne?.memoire ?? {};
}

function preparer(feuille: Feuille, memoire: MemoireColonnes) {
  const largeur = feuille.lignes.reduce((m, l) => Math.max(m, l.length), 0);
  const indexEntete = trouverEntete(feuille.lignes);
  // No recognisable header: the file is read as data, columns are mapped by hand.
  const entetes =
    indexEntete === null
      ? Array.from({ length: largeur }, (_, i) => `Colonne ${i + 1}`)
      : [...(feuille.lignes[indexEntete] ?? []), ...vide(largeur)].slice(0, largeur);
  const donnees = feuille.lignes.slice(indexEntete === null ? 0 : indexEntete + 1);
  const { correspondance, inconnues } = proposerCorrespondance(
    indexEntete === null ? [] : entetes,
    memoire,
  );
  return { entetes, donnees, correspondance, inconnues };
}

export async function creerImports(
  db: Database,
  instanceId: string,
  entree: NouvelImport,
): Promise<ApercuImport[]> {
  const feuilles = entree.texte
    ? [lireTexte(entree.texte)]
    : await lireFichier(entree.nomFichier, entree.contenu ?? Buffer.alloc(0));
  const utiles = feuilles.filter((f) => f.lignes.length > 0);
  if (utiles.length === 0) throw new FichierIllisible('Aucune ligne à lire dans ce fichier.');
  if (utiles.some((f) => f.lignes.length > LIGNES_MAX))
    throw new ImportRefuse(`Fichier trop gros : ${LIGNES_MAX} lignes au maximum par feuille.`);

  const ids: string[] = [];
  await withInstance(db, instanceId, async (tx) => {
    const memoire = await memoireDeSource(tx, instanceId, entree.provenance);
    for (const feuille of utiles) {
      const { entetes, donnees, correspondance } = preparer(feuille, memoire);
      const [cree] = await tx
        .insert(baseImports)
        .values({
          instanceId,
          nomFichier: entree.nomFichier,
          feuille: feuille.nom,
          provenance: entree.provenance,
          mandat: entree.mandat ?? null,
          collecteLe: entree.collecteLe ?? null,
          entetes,
          correspondance,
        })
        .returning({ id: baseImports.id });
      if (!cree) throw new Error('Import non créé');
      const lignes = calculerLignes(
        donnees.map((brut, i) => ({ numero: i + 1, brut, complements: null })),
        correspondance,
      );
      await insererLignes(tx, instanceId, cree.id, lignes);
      ids.push(cree.id);
    }
  });
  return Promise.all(ids.map((id) => apercu(db, instanceId, id)));
}

async function chargerImport(tx: Tx, instanceId: string, id: string): Promise<BaseImport> {
  const [imp] = await tx
    .select()
    .from(baseImports)
    .where(and(eq(baseImports.id, id), eq(baseImports.instanceId, instanceId)));
  if (!imp) throw new ImportIntrouvable('Import introuvable');
  return imp;
}

async function compteursDe(tx: Tx, instanceId: string, importId: string): Promise<Compteurs> {
  const lignes = await tx
    .select({
      statut: baseLignesBrutes.statut,
      zone: baseLignesBrutes.zone,
      n: count(),
    })
    .from(baseLignesBrutes)
    .where(
      and(eq(baseLignesBrutes.instanceId, instanceId), eq(baseLignesBrutes.importId, importId)),
    )
    .groupBy(baseLignesBrutes.statut, baseLignesBrutes.zone);
  const c: Compteurs = {
    total: 0,
    prospectables: 0,
    aEnrichir: 0,
    sousMinimum: 0,
    doublonsInternes: 0,
    integrees: 0,
  };
  for (const l of lignes) {
    c.total += l.n;
    if (l.statut === 'integre') c.integrees += l.n;
    else if (l.statut === 'sous_minimum') c.sousMinimum += l.n;
    else if (l.statut === 'doublon_interne') c.doublonsInternes += l.n;
    else if (l.zone === 'prospectable') c.prospectables += l.n;
    else c.aEnrichir += l.n;
  }
  return c;
}

export const FILTRES_LIGNES = ['pret', 'sous_minimum', 'doublon_interne', 'integre'] as const;

export async function apercu(
  db: Database,
  instanceId: string,
  id: string,
  filtre: StatutLigne = 'pret',
  limite = 40,
): Promise<ApercuImport> {
  return withInstance(db, instanceId, async (tx) => {
    const imp = await chargerImport(tx, instanceId, id);
    const lignes = await tx
      .select()
      .from(baseLignesBrutes)
      .where(
        and(
          eq(baseLignesBrutes.instanceId, instanceId),
          eq(baseLignesBrutes.importId, id),
          eq(baseLignesBrutes.statut, filtre),
        ),
      )
      .orderBy(asc(baseLignesBrutes.numero))
      .limit(limite);
    const echantillon = await tx
      .select({ brut: baseLignesBrutes.brut })
      .from(baseLignesBrutes)
      .where(and(eq(baseLignesBrutes.instanceId, instanceId), eq(baseLignesBrutes.importId, id)))
      .orderBy(asc(baseLignesBrutes.numero))
      .limit(3);
    const pris = new Set(Object.values(imp.correspondance));
    return {
      id: imp.id,
      nomFichier: imp.nomFichier,
      feuille: imp.feuille,
      provenance: imp.provenance,
      mandat: imp.mandat,
      collecteLe: imp.collecteLe,
      statut: imp.statut,
      creeLe: imp.createdAt,
      entetes: imp.entetes,
      correspondance: imp.correspondance,
      inconnues: imp.entetes.map((_, i) => i).filter((i) => !pris.has(i)),
      echantillon: echantillon.map((e) => e.brut),
      compteurs: await compteursDe(tx, instanceId, id),
      lignes: lignes.map((l) => ({
        numero: l.numero,
        statut: l.statut,
        zone: l.zone,
        raison: l.raison,
        avertissements: l.avertissements,
        fiche: l.fiche,
        brut: l.brut,
      })),
      rapport: imp.rapport,
    };
  });
}

export type ResumeImport = Pick<
  ApercuImport,
  'id' | 'nomFichier' | 'feuille' | 'provenance' | 'mandat' | 'statut' | 'creeLe' | 'rapport'
> & { compteurs: Compteurs };

export async function listerImports(db: Database, instanceId: string): Promise<ResumeImport[]> {
  return withInstance(db, instanceId, async (tx) => {
    const imports = await tx
      .select()
      .from(baseImports)
      .where(eq(baseImports.instanceId, instanceId))
      .orderBy(desc(baseImports.createdAt));
    return Promise.all(
      imports.map(async (imp) => ({
        id: imp.id,
        nomFichier: imp.nomFichier,
        feuille: imp.feuille,
        provenance: imp.provenance,
        mandat: imp.mandat,
        statut: imp.statut,
        creeLe: imp.createdAt,
        rapport: imp.rapport,
        compteurs: await compteursDe(tx, instanceId, imp.id),
      })),
    );
  });
}

// The user fixed a column: every line of the sheet is read again with the new mapping.
export async function reglerCorrespondance(
  db: Database,
  instanceId: string,
  id: string,
  demande: Record<string, number | null>,
): Promise<ApercuImport> {
  await withInstance(db, instanceId, async (tx) => {
    const imp = await chargerImport(tx, instanceId, id);
    if (imp.statut !== 'apercu')
      throw new ImportRefuse('Cet import est déjà intégré : sa correspondance ne change plus.');
    const correspondance: Correspondance = {};
    const utilises = new Set<number>();
    for (const [champ, index] of Object.entries(demande)) {
      if (!(CHAMPS_CIBLES as readonly string[]).includes(champ))
        throw new ImportRefuse(`Champ inconnu : ${champ}`);
      if (index === null) continue;
      if (!Number.isInteger(index) || index < 0 || index >= imp.entetes.length)
        throw new ImportRefuse('Colonne inconnue');
      if (utilises.has(index)) throw new ImportRefuse('Une colonne ne peut remplir qu’un champ.');
      utilises.add(index);
      correspondance[champ as ChampCible] = index;
    }
    const anciennes = await tx
      .select()
      .from(baseLignesBrutes)
      .where(and(eq(baseLignesBrutes.instanceId, instanceId), eq(baseLignesBrutes.importId, id)))
      .orderBy(asc(baseLignesBrutes.numero));
    const lignes = calculerLignes(
      anciennes.map((l) => ({ numero: l.numero, brut: l.brut, complements: l.complements })),
      correspondance,
    );
    await tx
      .delete(baseLignesBrutes)
      .where(and(eq(baseLignesBrutes.instanceId, instanceId), eq(baseLignesBrutes.importId, id)));
    await insererLignes(tx, instanceId, id, lignes);
    await tx
      .update(baseImports)
      .set({ correspondance, updatedAt: new Date() })
      .where(eq(baseImports.id, id));
  });
  return apercu(db, instanceId, id);
}

const CHAMPS_COMPLETABLES = [
  'entreprise',
  'prenom',
  'nom',
  'email',
  'telephone',
  'fonction',
] as const;

// Completing a line left in the airlock (company or name missing, or a contact way added).
export async function completerLigne(
  db: Database,
  instanceId: string,
  id: string,
  numero: number,
  champs: Partial<Record<(typeof CHAMPS_COMPLETABLES)[number], string>>,
): Promise<LigneApercu> {
  return withInstance(db, instanceId, async (tx) => {
    const imp = await chargerImport(tx, instanceId, id);
    const [ligne] = await tx
      .select()
      .from(baseLignesBrutes)
      .where(
        and(
          eq(baseLignesBrutes.instanceId, instanceId),
          eq(baseLignesBrutes.importId, id),
          eq(baseLignesBrutes.numero, numero),
        ),
      );
    if (!ligne) throw new ImportIntrouvable('Ligne introuvable');
    if (ligne.statut === 'integre' || ligne.statut === 'doublon_interne')
      throw new ImportRefuse('Cette ligne ne se complète plus.');
    const complements = { ...(ligne.complements ?? {}) };
    for (const champ of CHAMPS_COMPLETABLES) {
      const valeur = champs[champ]?.trim();
      if (valeur) complements[champ] = valeur;
    }
    const calculee = calculerLigne(numero, ligne.brut, imp.correspondance, complements);
    await tx
      .update(baseLignesBrutes)
      .set({
        complements,
        fiche: calculee.fiche,
        statut: calculee.statut,
        zone: calculee.zone,
        raison: calculee.raison,
        avertissements: calculee.avertissements,
        updatedAt: new Date(),
      })
      .where(eq(baseLignesBrutes.id, ligne.id));
    return {
      numero,
      statut: calculee.statut,
      zone: calculee.zone,
      raison: calculee.raison,
      avertissements: calculee.avertissements,
      fiche: calculee.fiche,
      brut: ligne.brut,
    };
  });
}

export type RapportIntegration = {
  creees: number;
  fusionnees: number;
  restantes: number;
};

// Validated by the user: lines ready leave the airlock, batch by batch, through the single entry
// point of the living base. Replays are harmless (only lines still `pret` move).
export async function integrerImport(
  db: Database,
  instanceId: string,
  id: string,
): Promise<RapportIntegration> {
  const imp = await withInstance(db, instanceId, (tx) => chargerImport(tx, instanceId, id));
  let creees = 0;
  let fusionnees = 0;
  for (;;) {
    const lot = await withInstance(db, instanceId, async (tx) => {
      const lignes = await tx
        .select()
        .from(baseLignesBrutes)
        .where(
          and(
            eq(baseLignesBrutes.instanceId, instanceId),
            eq(baseLignesBrutes.importId, id),
            eq(baseLignesBrutes.statut, 'pret'),
          ),
        )
        .orderBy(asc(baseLignesBrutes.numero))
        .limit(LOT)
        .for('update', { skipLocked: true });
      if (lignes.length === 0) return 0;
      const resultats = await integrerFiches(
        tx,
        instanceId,
        lignes.map((l) => ({
          fiche: l.fiche,
          provenance: imp.provenance,
          mandat: imp.mandat,
          importId: imp.id,
          collecteLe: imp.collecteLe,
        })),
      );
      for (const [i, ligne] of lignes.entries()) {
        const r = resultats[i];
        if (!r) continue;
        if (r.fusionnee) fusionnees++;
        else creees++;
        await tx
          .update(baseLignesBrutes)
          .set({ statut: 'integre', ficheId: r.id, updatedAt: new Date() })
          .where(eq(baseLignesBrutes.id, ligne.id));
      }
      return lignes.length;
    });
    if (lot === 0) break;
  }

  return withInstance(db, instanceId, async (tx) => {
    const precedent = imp.rapport ?? { creees: 0, fusionnees: 0 };
    const rapport = {
      creees: precedent.creees + creees,
      fusionnees: precedent.fusionnees + fusionnees,
    };
    await tx
      .update(baseImports)
      .set({ statut: 'integre', rapport, updatedAt: new Date() })
      .where(eq(baseImports.id, id));
    const memoire = {
      ...(await memoireDeSource(tx, instanceId, imp.provenance)),
      ...memoireDe(imp.entetes, imp.correspondance),
    };
    await tx
      .insert(baseCorrespondances)
      .values({ instanceId, provenance: imp.provenance, memoire })
      .onConflictDoUpdate({
        target: [baseCorrespondances.instanceId, baseCorrespondances.provenance],
        set: { memoire, misAJourLe: new Date(), updatedAt: new Date() },
      });
    const compteurs = await compteursDe(tx, instanceId, id);
    return { creees, fusionnees, restantes: compteurs.sousMinimum };
  });
}

export async function annulerImport(db: Database, instanceId: string, id: string): Promise<void> {
  await withInstance(db, instanceId, async (tx) => {
    const imp = await chargerImport(tx, instanceId, id);
    if (imp.statut === 'integre')
      throw new ImportRefuse('Cet import est déjà intégré à la base : il ne s’annule plus.');
    await tx.delete(baseImports).where(eq(baseImports.id, id));
  });
}

export async function listerFiches(
  db: Database,
  instanceId: string,
  options: { zone?: Zone; q?: string; limite?: number; decalage?: number } = {},
) {
  return withInstance(db, instanceId, async (tx) => {
    const recherche = options.q?.trim();
    const motif = recherche ? `%${recherche.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const filtres = [
      eq(baseVivante.instanceId, instanceId),
      ...(options.zone ? [eq(baseVivante.zone, options.zone)] : []),
      ...(motif
        ? [
            or(
              ilike(baseVivante.entreprise, motif),
              ilike(baseVivante.nom, motif),
              ilike(baseVivante.prenom, motif),
              ilike(baseVivante.email, motif),
            ) ?? sql`true`,
          ]
        : []),
    ];
    const fiches = await tx
      .select()
      .from(baseVivante)
      .where(and(...filtres))
      .orderBy(asc(baseVivante.entreprise), asc(baseVivante.nom))
      .limit(Math.min(options.limite ?? 50, 200))
      .offset(options.decalage ?? 0);
    const parZone = await tx
      .select({ zone: baseVivante.zone, n: count() })
      .from(baseVivante)
      .where(eq(baseVivante.instanceId, instanceId))
      .groupBy(baseVivante.zone);
    const nombre = (z: Zone) => parZone.find((p) => p.zone === z)?.n ?? 0;
    const [{ n: total } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(baseVivante)
      .where(and(...filtres));
    return {
      fiches,
      total,
      compteurs: { aEnrichir: nombre('a_enrichir'), prospectable: nombre('prospectable') },
    };
  });
}
