import { and, asc, count, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  ErreurAnnuaire,
  type ClientAnnuaire,
  type EntrepriseAnnuaire,
  type PageAnnuaire,
} from '../annuaire/client.js';
import { criteresValides, versParametres } from '../annuaire/criteres.js';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import {
  FicheIntrouvable,
  integrerFiches,
  modifierEtiquettes,
  normaliserEtiquette,
  rattacherEntreprise,
} from './integration.js';
import { ajouterALaListe, ajouterEntreprisesALaListe, typeDeLaListe } from './listes.js';
import { normaliserFiche } from './nettoyage.js';
import { baseEntreprises, baseVivante, type EntrepriseBase } from './schema.js';

export class EntrepriseIntrouvable extends Error {}
export class SirenInvalide extends ErreurAnnuaire {}
export class RechercheRefusee extends Error {}

// One company per SIREN and per instance: a second link refreshes what the directory says.
// The website, found elsewhere, is never overwritten by a refresh.
export async function enregistrerEntreprise(
  tx: Tx,
  instanceId: string,
  e: EntrepriseAnnuaire,
): Promise<EntrepriseBase> {
  const valeurs = {
    nom: e.nom,
    formeJuridique: e.formeJuridique,
    naf: e.naf,
    categorie: e.categorie,
    effectif: e.effectif,
    creeLe: e.creeLe,
    active: e.active,
    etablissementsOuverts: e.etablissementsOuverts,
    oppositionDiffusion: e.oppositionDiffusion,
    siret: e.siret,
    adresse: e.adresse,
    codePostal: e.codePostal,
    ville: e.ville,
    departement: e.departement,
    latitude: e.latitude,
    longitude: e.longitude,
    finances: e.finances,
    dirigeants: e.dirigeants,
    annuaireLe: new Date(),
    updatedAt: new Date(),
  };
  const [ligne] = await tx
    .insert(baseEntreprises)
    .values({ instanceId, siren: e.siren, ...valeurs })
    .onConflictDoUpdate({
      target: [baseEntreprises.instanceId, baseEntreprises.siren],
      set: valeurs,
    })
    .returning();
  if (!ligne) throw new Error('Entreprise non enregistrée');
  return ligne;
}

export async function lireEntreprise(
  db: Executor,
  instanceId: string,
  id: string,
): Promise<EntrepriseBase> {
  const [e] = await withInstance(db, instanceId, (tx) =>
    tx
      .select()
      .from(baseEntreprises)
      .where(and(eq(baseEntreprises.id, id), eq(baseEntreprises.instanceId, instanceId))),
  );
  if (!e) throw new EntrepriseIntrouvable('Entreprise introuvable');
  return e;
}

async function nomDeLaFiche(db: Executor, instanceId: string, id: string): Promise<string> {
  const [f] = await withInstance(db, instanceId, (tx) =>
    tx
      .select({ entreprise: baseVivante.entreprise })
      .from(baseVivante)
      .where(and(eq(baseVivante.id, id), eq(baseVivante.instanceId, instanceId))),
  );
  if (!f) throw new FicheIntrouvable('Fiche introuvable');
  return f.entreprise;
}

// Some lists write the place after the name (« Atelier — Dijon / Longvic (21) »): the directory
// knows the company by its name alone, and the number is the département to narrow the search.
export function nomRecherche(entreprise: string): { nom: string; departement: string | null } {
  const m = /^(.+?)\s+[—–-]\s+.+\((\d{2,3}|2[AB])\)\s*$/.exec(entreprise.trim());
  return m?.[1]
    ? { nom: m[1].trim(), departement: m[2] ?? null }
    : { nom: entreprise.trim(), departement: null };
}

// Nothing is linked on its own: the directory only proposes, the pilot picks.
export async function candidatsPourFiche(
  db: Executor,
  annuaire: ClientAnnuaire,
  instanceId: string,
  ficheId: string,
): Promise<EntrepriseAnnuaire[]> {
  const { nom, departement } = nomRecherche(await nomDeLaFiche(db, instanceId, ficheId));
  return annuaire.chercher(nom, { limite: 5, ...(departement ? { departement } : {}) });
}

export async function rattacherParSiren(
  db: Executor,
  annuaire: ClientAnnuaire,
  instanceId: string,
  ficheId: string,
  siren: string,
): Promise<{ entreprise: EntrepriseBase; rattachees: number }> {
  const chiffres = siren.replace(/\s/g, '');
  if (!/^\d{9}$/.test(chiffres)) throw new SirenInvalide('SIREN invalide : 9 chiffres attendus.');
  await nomDeLaFiche(db, instanceId, ficheId);
  const trouvee = await annuaire.parSiren(chiffres);
  if (!trouvee) throw new EntrepriseIntrouvable('Aucune entreprise avec ce SIREN dans l’annuaire.');
  return withInstance(db, instanceId, async (tx) => {
    const entreprise = await enregistrerEntreprise(tx, instanceId, trouvee);
    return {
      entreprise,
      rattachees: await rattacherEntreprise(tx, instanceId, ficheId, entreprise.id),
    };
  });
}

export const PROVENANCE_RECHERCHE = 'Recherche d’entreprises';
export const MAX_AJOUT = 25;

// One page of the directory for the given criteria, each result marked when the base already
// holds the company.
export async function rechercherEntreprises(
  db: Executor,
  annuaire: ClientAnnuaire,
  instanceId: string,
  brut: Record<string, unknown>,
  page: number,
): Promise<PageAnnuaire & { dejaDansLaBase: string[] }> {
  const criteres = criteresValides(brut);
  try {
    versParametres(criteres);
  } catch (e) {
    throw new RechercheRefusee(e instanceof Error ? e.message : 'Critères invalides.');
  }
  const resultat = await annuaire.rechercher(criteres, page);
  const sirens = resultat.resultats.map((r) => r.siren);
  const connues =
    sirens.length === 0
      ? []
      : await withInstance(db, instanceId, (tx) =>
          tx
            .select({ siren: baseEntreprises.siren })
            .from(baseEntreprises)
            .where(
              and(
                eq(baseEntreprises.instanceId, instanceId),
                inArray(baseEntreprises.siren, sirens),
              ),
            ),
        );
  return { ...resultat, dejaDansLaBase: connues.map((c) => c.siren) };
}

export type RapportAjout = { ajoutees: number; existantes: number; introuvables: number };

// The companies picked in a search enter the base as « à enrichir » records (company only),
// linked to the directory. A company the base already knows by name keeps its contacts: they are
// linked, nothing new is created. The directory is asked again for each SIREN: the screen's data
// is never trusted.
export async function ajouterEntreprises(
  db: Executor,
  annuaire: ClientAnnuaire,
  instanceId: string,
  sirens: string[],
  listeId?: string,
  // Étiquette posée sur chaque fiche ajoutée ou rattachée : l'ICP d'où vient la recherche.
  etiquette?: string,
): Promise<RapportAjout> {
  const uniques = [...new Set(sirens.map((s) => s.replace(/\s/g, '')))];
  if (uniques.length === 0) throw new RechercheRefusee('Choisissez au moins une entreprise.');
  if (uniques.length > MAX_AJOUT)
    throw new RechercheRefusee(`Ajoutez ${MAX_AJOUT} entreprises au plus à la fois.`);
  if (uniques.some((s) => !/^\d{9}$/.test(s)))
    throw new SirenInvalide('SIREN invalide : 9 chiffres attendus.');
  const rapport: RapportAjout = { ajoutees: 0, existantes: 0, introuvables: 0 };
  const ficheIds: string[] = [];
  const entrepriseIds: string[] = [];
  // A bad list is refused before anything is written.
  const typeListe = listeId ? await typeDeLaListe(db, instanceId, listeId) : null;
  // Étiquette invalide : refusée avant d'écrire quoi que ce soit.
  const tag = etiquette?.trim() ? normaliserEtiquette(etiquette) : null;
  for (const siren of uniques) {
    const e = await annuaire.parSiren(siren);
    if (!e) {
      rapport.introuvables++;
      continue;
    }
    await withInstance(db, instanceId, async (tx) => {
      const entreprise = await enregistrerEntreprise(tx, instanceId, e);
      const [connue] = await tx
        .select({ id: baseVivante.id })
        .from(baseVivante)
        .where(
          and(
            eq(baseVivante.instanceId, instanceId),
            sql`lower(trim(${baseVivante.entreprise})) = lower(trim(${e.nom}))`,
          ),
        )
        .limit(1);
      const existante = connue ?? null;
      let ficheId = existante?.id;
      if (!ficheId) {
        const [cree] = await integrerFiches(tx, instanceId, [
          {
            fiche: normaliserFiche({ entreprise: e.nom }).fiche,
            provenance: PROVENANCE_RECHERCHE,
            mandat: null,
            importId: null,
            collecteLe: null,
          },
        ]);
        ficheId = cree?.id;
        if (cree?.fusionnee) rapport.existantes++;
        else rapport.ajoutees++;
      } else rapport.existantes++;
      if (!ficheId) throw new Error('Fiche non créée');
      await rattacherEntreprise(tx, instanceId, ficheId, entreprise.id);
      ficheIds.push(ficheId);
      entrepriseIds.push(entreprise.id);
    });
  }
  if (tag && ficheIds.length > 0)
    await withInstance(db, instanceId, (tx) =>
      modifierEtiquettes(tx, instanceId, ficheIds, { ajouter: [tag] }),
    );
  if (listeId && typeListe === 'entreprises')
    await ajouterEntreprisesALaListe(db, instanceId, listeId, entrepriseIds);
  else if (listeId) await ajouterALaListe(db, instanceId, listeId, ficheIds);
  return rapport;
}

export type LigneEntreprise = {
  id: string;
  siren: string;
  nom: string;
  ville: string | null;
  departement: string | null;
  naf: string | null;
  effectif: string | null;
  categorie: string | null;
  // Latest published turnover; null when none or not disclosed (0).
  ca: number | null;
  nbContacts: number;
  listes: string[];
  // The most serious recent BODACC notice, if any; `signauxLe` null = never checked.
  signal: { gravite: 'alerte' | 'attention' | 'info'; nature: string; date: string } | null;
  signauxLe: string | null;
  siteWeb: string | null;
  // The first number found on the company's site.
  standard: string | null;
};

const PAR_PAGE_ENTREPRISES = 50;

// Search by name, SIREN or city, and optionally within one list of companies.
export function filtreEntreprises(
  instanceId: string,
  { q, liste, signal }: { q?: string; liste?: string; signal?: string },
) {
  const motif = q?.trim() ? `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return and(
    eq(baseEntreprises.instanceId, instanceId),
    motif
      ? or(
          ilike(baseEntreprises.nom, motif),
          ilike(baseEntreprises.siren, motif),
          ilike(baseEntreprises.ville, motif),
        )
      : undefined,
    liste
      ? sql`exists (select 1 from base_liste_entreprises m where m.entreprise_id = ${baseEntreprises.id} and m.liste_id = ${liste})`
      : undefined,
    signal === 'alerte'
      ? sql`exists (select 1 from base_signaux g where g.entreprise_id = ${baseEntreprises.id} and g.gravite = 'alerte')`
      : signal === 'attention'
        ? sql`exists (select 1 from base_signaux g where g.entreprise_id = ${baseEntreprises.id} and g.gravite in ('alerte', 'attention'))`
        : signal === 'jamais'
          ? sql`${baseEntreprises.signauxLe} is null`
          : undefined,
  );
}

// The companies of the base, with how many real contacts each has (a company-only record is not
// a contact) and the lists of companies it belongs to.
export async function listerEntreprisesBase(
  db: Executor,
  instanceId: string,
  { q, liste, signal, page = 0 }: { q?: string; liste?: string; signal?: string; page?: number },
): Promise<{ entreprises: LigneEntreprise[]; total: number }> {
  const filtre = filtreEntreprises(instanceId, { q, liste, signal });
  return withInstance(db, instanceId, async (tx) => {
    const lignes = await tx
      .select({
        id: baseEntreprises.id,
        siren: baseEntreprises.siren,
        nom: baseEntreprises.nom,
        ville: baseEntreprises.ville,
        departement: baseEntreprises.departement,
        naf: baseEntreprises.naf,
        effectif: baseEntreprises.effectif,
        categorie: baseEntreprises.categorie,
        ca: sql<number | null>`nullif((${baseEntreprises.finances}->0->>'ca')::numeric, 0)::float8`,
        nbContacts: sql<number>`(select count(*)::int from base_vivante v where v.entreprise_id = ${sql.raw('"base_entreprises"."id"')} and trim(v.nom) <> '')`,
        listes: sql<
          string[]
        >`coalesce((select array_agg(m.liste_id::text) from base_liste_entreprises m where m.entreprise_id = ${sql.raw('"base_entreprises"."id"')}), '{}')`,
        signal: sql<
          LigneEntreprise['signal']
        >`(select to_jsonb(x) from (select g.gravite, g.nature, g.date from base_signaux g where g.entreprise_id = ${sql.raw('"base_entreprises"."id"')} order by case g.gravite when 'alerte' then 0 when 'attention' then 1 else 2 end, g.date desc limit 1) x)`,
        signauxLe: sql<string | null>`${baseEntreprises.signauxLe}`,
        siteWeb: baseEntreprises.siteWeb,
        standard: sql<string | null>`${baseEntreprises.siteTelephones}[1]`,
      })
      .from(baseEntreprises)
      .where(filtre)
      .orderBy(asc(sql`lower(${baseEntreprises.nom})`), asc(baseEntreprises.id))
      .limit(PAR_PAGE_ENTREPRISES)
      .offset(Math.max(0, page) * PAR_PAGE_ENTREPRISES);
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(baseEntreprises).where(filtre);
    return { entreprises: lignes, total: n };
  });
}
