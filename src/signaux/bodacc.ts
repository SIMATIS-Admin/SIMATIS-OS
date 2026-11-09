import { z } from 'zod';
import type { FetchLike } from '../connecteurs/google/oauth.js';

// BODACC : le Bulletin officiel des annonces civiles et commerciales (données ouvertes). Ses
// annonces disent ce qui arrive à une entreprise : procédure collective, cession de fonds,
// radiation… Gratuit, sans clé ; interrogé par SIREN.
const URL_BODACC =
  'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';

export type Gravite = 'alerte' | 'attention' | 'info';

export type Signal = {
  sourceId: string;
  date: string;
  famille: string;
  nature: string;
  gravite: Gravite;
  detail: string | null;
  url: string | null;
};

const texte = z.string().nullish();
const annonceSchema = z.object({
  id: z.string(),
  dateparution: z.string(),
  typeavis_lib: texte,
  familleavis_lib: texte,
  tribunal: texte,
  url_complete: texte,
  jugement: texte,
  acte: texte,
  modificationsgenerales: texte,
  radiationaurcs: texte,
});
export type AnnonceBrute = z.infer<typeof annonceSchema>;

export class ErreurBodacc extends Error {}

const json = (brut: string | null | undefined): Record<string, unknown> => {
  if (!brut) return {};
  try {
    const v: unknown = JSON.parse(brut);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const chaine = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const court = (t: string | null, max: number): string | null => (t ? t.slice(0, max) : null);

// What matters for a salesperson: a company in difficulty is not to be prospected like another
// (alerte), a sale of the business may change who decides (attention), the rest is information.
// Filings of accounts, cancelled notices and miscellaneous notices say nothing useful.
export function classer(a: AnnonceBrute): Signal | null {
  if (a.typeavis_lib?.includes('annulation')) return null;
  const jugement = json(a.jugement);
  const acte = json(a.acte);
  const base = {
    sourceId: a.id,
    date: a.dateparution.slice(0, 10),
    url: a.url_complete ?? null,
  };
  switch (a.familleavis_lib) {
    case 'Procédures collectives':
      return {
        ...base,
        famille: 'Procédure collective',
        nature: court(chaine(jugement.nature), 200) ?? 'Procédure collective',
        gravite: 'alerte',
        detail: court(chaine(jugement.complementJugement), 500),
      };
    case 'Procédures de conciliation':
      return {
        ...base,
        famille: 'Conciliation',
        nature: court(chaine(jugement.nature), 200) ?? 'Procédure de conciliation',
        gravite: 'alerte',
        detail: court(chaine(jugement.complementJugement), 500),
      };
    case 'Procédures de rétablissement professionnel':
      return {
        ...base,
        famille: 'Rétablissement professionnel',
        nature: court(chaine(jugement.nature), 200) ?? 'Procédure de rétablissement professionnel',
        gravite: 'alerte',
        detail: court(chaine(jugement.complementJugement), 500),
      };
    case 'Radiations':
      return {
        ...base,
        famille: 'Radiation',
        nature: court(chaine(json(a.radiationaurcs).commentaire), 200) ?? 'Radiation',
        gravite: 'alerte',
        detail: null,
      };
    case 'Ventes et cessions': {
      const vente = (acte.vente ?? {}) as Record<string, unknown>;
      return {
        ...base,
        famille: 'Vente ou cession',
        nature: court(chaine(vente.categorieVente), 200) ?? 'Vente ou cession de fonds',
        gravite: 'attention',
        detail: court(chaine(acte.descriptif), 500),
      };
    }
    case 'Modifications diverses':
      return {
        ...base,
        famille: 'Modification',
        nature: court(chaine(json(a.modificationsgenerales).descriptif), 200) ?? 'Modification',
        gravite: 'info',
        detail: null,
      };
    case 'Créations':
      return { ...base, famille: 'Création', nature: 'Création', gravite: 'info', detail: null };
    case 'Immatriculations':
      return {
        ...base,
        famille: 'Immatriculation',
        nature: 'Immatriculation',
        gravite: 'info',
        detail: null,
      };
    default:
      return null;
  }
}

export type ClientBodacc = {
  annonces(siren: string, depuis: string): Promise<AnnonceBrute[]>;
};

export function creerClientBodacc({
  fetchFn = fetch,
  attendre = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
}: { fetchFn?: FetchLike; attendre?: (ms: number) => Promise<void> } = {}): ClientBodacc {
  let dernier = 0;
  return {
    async annonces(siren, depuis) {
      if (!/^\d{9}$/.test(siren)) throw new ErreurBodacc('SIREN invalide : 9 chiffres attendus.');
      const delai = Math.max(0, 300 - (Date.now() - dernier));
      if (delai > 0) await attendre(delai);
      dernier = Date.now();
      const params = new URLSearchParams({
        where: `registre="${siren}" and dateparution>=date'${depuis}' and familleavis_lib!="Dépôts des comptes"`,
        order_by: 'dateparution desc',
        limit: '50',
      });
      let res: Response;
      try {
        res = await fetchFn(`${URL_BODACC}?${params.toString()}`, { method: 'GET' });
      } catch {
        throw new ErreurBodacc('BODACC indisponible.');
      }
      if (!res.ok) throw new ErreurBodacc(`BODACC indisponible (HTTP ${res.status}).`);
      const lu = z
        .object({ results: z.array(annonceSchema) })
        .safeParse(await res.json().catch(() => null));
      if (!lu.success) throw new ErreurBodacc('Réponse du BODACC illisible.');
      return lu.data.results;
    },
  };
}
