import { desc, eq } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import { entreprises } from '../crm/schema.js';
import type { Instance } from '../instances/schema.js';
import { ateliersStrategie } from './schema.js';
import { AtelierIndisponible, atelierActif } from './service.js';

// Les sept champs de l'ICP et du persona, dans l'ordre où l'écran de l'Atelier les enregistre
// (web/src/pages/atelier/etat.ts, CLES_ICP et CLES_PERSONA) : l'état ne garde que les valeurs.
export const CLES_ICP = [
  'Catégorie',
  'Localisation',
  'Contexte',
  'Maturité',
  'Objectif',
  'Sensibilité prix',
  'Décision',
] as const;
export const CLES_PERSONA = [
  'Poste',
  'Objectifs',
  'Craintes',
  'Souffrances',
  'Chemin d’achat',
  'Objections',
  'Déclencheur',
] as const;

export type ChampCiblage = { cle: string; valeur: string };
export type CiblageLu = {
  atelierId: string;
  atelierTitre: string;
  entreprise: string | null;
  code: string;
  nom: string;
  offre: string;
  icp: ChampCiblage[];
  persona: ChampCiblage[];
};

const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// Les champs renseignés seulement, nommés ; l'état est lu avec prudence (sauvegarde ancienne ou
// importée) : tout ce qui n'a pas la bonne forme est ignoré.
const champs = (cles: readonly string[], valeurs: unknown): ChampCiblage[] =>
  Array.isArray(valeurs)
    ? cles.flatMap((cle, i) => {
        const valeur = texte(valeurs[i]);
        return valeur ? [{ cle, valeur }] : [];
      })
    : [];

// Les ICP et personas des ateliers de l'espace, du plus récent au plus ancien. Un ICP sans aucun
// champ renseigné n'est pas une cible : il n'est pas listé. Lecture seule.
export async function lireCiblages(db: Executor, instance: Instance): Promise<CiblageLu[]> {
  if (!atelierActif(instance))
    throw new AtelierIndisponible("L'atelier stratégique n'est pas activé dans cet espace.");
  return withInstance(db, instance.id, async (tx) => {
    const lignes = await tx
      .select({
        id: ateliersStrategie.id,
        titre: ateliersStrategie.titre,
        etat: ateliersStrategie.etat,
        entreprise: entreprises.nom,
      })
      .from(ateliersStrategie)
      .leftJoin(entreprises, eq(entreprises.id, ateliersStrategie.entrepriseId))
      .where(eq(ateliersStrategie.instanceId, instance.id))
      .orderBy(desc(ateliersStrategie.updatedAt));
    return lignes.flatMap((l) => {
      const icps: unknown = l.etat.icps;
      if (!Array.isArray(icps)) return [];
      return icps.flatMap((x: unknown, i): CiblageLu[] => {
        const brut = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
        const icp = champs(CLES_ICP, brut.icp);
        if (icp.length === 0) return [];
        return [
          {
            atelierId: l.id,
            atelierTitre: l.titre,
            entreprise: l.entreprise,
            code: texte(brut.code) || `ICP ${String.fromCharCode(65 + i)}`,
            nom: texte(brut.name),
            offre: texte(brut.offer),
            icp,
            persona: champs(CLES_PERSONA, brut.persona),
          },
        ];
      });
    });
  });
}

// La demande, en français, que la recherche de prospects sait interpréter : l'entreprise idéale
// (catégorie, localisation, contexte) et la personne à joindre (poste). Les champs qui ne servent
// pas à trouver une entreprise (maturité, prix, craintes…) restent dans l'Atelier.
export function composerDemande(c: CiblageLu): string {
  const val = (liste: ChampCiblage[], cle: string) => liste.find((x) => x.cle === cle)?.valeur;
  const lignes = [
    val(c.icp, 'Catégorie') && `Entreprises : ${val(c.icp, 'Catégorie')}`,
    val(c.icp, 'Localisation') && `Localisation : ${val(c.icp, 'Localisation')}`,
    val(c.icp, 'Contexte') && `Contexte : ${val(c.icp, 'Contexte')}`,
    val(c.persona, 'Poste') && `Interlocuteur : ${val(c.persona, 'Poste')}`,
  ].filter((l): l is string => !!l);
  return lignes.join('\n');
}
