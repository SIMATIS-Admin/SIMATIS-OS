import { z } from 'zod';
import type { FetchLike } from '../connecteurs/google/oauth.js';

// Annuaire des entreprises de l'État (données SIRENE, RNE, comptes publiés) : API publique et
// gratuite, sans clé. Elle refuse au-delà d'environ 7 appels par seconde.
const URL_RECHERCHE = 'https://recherche-entreprises.api.gouv.fr/search';

const EFFECTIFS: Record<string, string> = {
  NN: 'Sans salarié',
  '00': '0 salarié',
  '01': '1 à 2 salariés',
  '02': '3 à 5 salariés',
  '03': '6 à 9 salariés',
  '11': '10 à 19 salariés',
  '12': '20 à 49 salariés',
  '21': '50 à 99 salariés',
  '22': '100 à 199 salariés',
  '31': '200 à 249 salariés',
  '32': '250 à 499 salariés',
  '41': '500 à 999 salariés',
  '42': '1 000 à 1 999 salariés',
  '51': '2 000 à 4 999 salariés',
  '52': '5 000 à 9 999 salariés',
  '53': '10 000 salariés et plus',
};
export const libelleEffectif = (code: string | null | undefined): string | null =>
  (code && EFFECTIFS[code]) || null;

export type Dirigeant = { nom: string; fonction: string | null; societe: boolean };
export type ExerciceFinancier = { annee: number; ca: number | null; resultat: number | null };

// Ce que la base garde d'une entreprise. Les dates de naissance et nationalités des dirigeants,
// que l'API fournit, ne sont volontairement pas reprises : inutiles pour prospecter.
export type EntrepriseAnnuaire = {
  siren: string;
  nom: string;
  formeJuridique: string | null;
  naf: string | null;
  categorie: string | null;
  effectif: string | null;
  creeLe: string | null;
  active: boolean;
  etablissementsOuverts: number | null;
  oppositionDiffusion: boolean;
  siret: string | null;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  departement: string | null;
  latitude: number | null;
  longitude: number | null;
  finances: ExerciceFinancier[];
  dirigeants: Dirigeant[];
};

export class ErreurAnnuaire extends Error {}

const texte = z.string().nullish();
const nombre = z.coerce.number().nullish();
const dirigeant = z.object({
  type_dirigeant: texte,
  nom: texte,
  prenoms: texte,
  denomination: texte,
  qualite: texte,
});
const resultatApi = z.object({
  siren: z.string().regex(/^\d{9}$/),
  nom_complet: z.string(),
  nature_juridique: texte,
  activite_principale: texte,
  categorie_entreprise: texte,
  tranche_effectif_salarie: texte,
  date_creation: texte,
  etat_administratif: texte,
  nombre_etablissements_ouverts: z.number().nullish(),
  opposition_diffusion_commerciale: z.boolean().nullish(),
  siege: z
    .object({
      siret: texte,
      adresse: texte,
      code_postal: texte,
      libelle_commune: texte,
      departement: texte,
      latitude: nombre,
      longitude: nombre,
    })
    .nullish(),
  finances: z
    .record(z.string(), z.object({ ca: z.number().nullish(), resultat_net: z.number().nullish() }))
    .nullish(),
  dirigeants: z.array(dirigeant).nullish(),
});
const reponseApi = z.object({ results: z.array(resultatApi) });

function nomDirigeant(d: z.infer<typeof dirigeant>): string | null {
  if (d.type_dirigeant === 'personne morale') return d.denomination?.trim() || null;
  const prenoms = (d.prenoms ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ');
  return [prenoms, d.nom?.trim()].filter(Boolean).join(' ') || null;
}

const dedoublonner = (liste: Dirigeant[]): Dirigeant[] => {
  const vus = new Set<string>();
  return liste.filter((d) => {
    const cle = `${d.nom}|${d.fonction}`;
    return vus.has(cle) ? false : (vus.add(cle), true);
  });
};

function convertir(r: z.infer<typeof resultatApi>): EntrepriseAnnuaire {
  const s = r.siege;
  return {
    siren: r.siren,
    nom: r.nom_complet,
    formeJuridique: r.nature_juridique || null,
    naf: r.activite_principale || null,
    categorie: r.categorie_entreprise || null,
    effectif: libelleEffectif(r.tranche_effectif_salarie),
    creeLe: r.date_creation || null,
    active: r.etat_administratif !== 'C',
    etablissementsOuverts: r.nombre_etablissements_ouverts ?? null,
    oppositionDiffusion: r.opposition_diffusion_commerciale === true,
    siret: s?.siret || null,
    adresse: s?.adresse || null,
    codePostal: s?.code_postal || null,
    ville: s?.libelle_commune || null,
    departement: s?.departement || null,
    latitude: s?.latitude ?? null,
    longitude: s?.longitude ?? null,
    finances: Object.entries(r.finances ?? {})
      .map(([annee, f]) => ({
        annee: Number(annee),
        ca: f.ca ?? null,
        resultat: f.resultat_net ?? null,
      }))
      .filter((f) => Number.isInteger(f.annee))
      .sort((a, b) => b.annee - a.annee),
    dirigeants: dedoublonner(
      (r.dirigeants ?? [])
        // Un commissaire aux comptes contrôle l'entreprise, il ne la dirige pas.
        .filter((d) => !/commissaire aux comptes/i.test(d.qualite ?? ''))
        .flatMap((d) => {
          const nom = nomDirigeant(d);
          return nom
            ? [
                {
                  nom,
                  fonction: d.qualite?.trim() || null,
                  societe: d.type_dirigeant === 'personne morale',
                },
              ]
            : [];
        }),
    ),
  };
}

export type ClientAnnuaire = {
  chercher(
    recherche: string,
    options?: { departement?: string; limite?: number },
  ): Promise<EntrepriseAnnuaire[]>;
  parSiren(siren: string): Promise<EntrepriseAnnuaire | null>;
};

export function creerClientAnnuaire(
  options: {
    fetchFn?: FetchLike;
    attendre?: (ms: number) => Promise<void>;
    intervalleMs?: number;
  } = {},
): ClientAnnuaire {
  const fetchFn = options.fetchFn ?? fetch;
  const attendre = options.attendre ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const intervalle = options.intervalleMs ?? 200;
  // Les appels passent l'un après l'autre, espacés : l'API ne tolère pas les rafales.
  let file: Promise<unknown> = Promise.resolve();
  let dernier = 0;

  const appeler = async (url: string, essai = 0): Promise<unknown> => {
    const delai = Math.max(0, intervalle - (Date.now() - dernier));
    if (delai > 0) await attendre(delai);
    dernier = Date.now();
    const res = await fetchFn(url, { method: 'GET' });
    if (res.status === 429) {
      if (essai >= 1)
        throw new ErreurAnnuaire(
          'Limite de débit de l’annuaire atteinte. Réessayez dans un instant.',
        );
      await attendre(1000);
      return appeler(url, essai + 1);
    }
    if (!res.ok)
      throw new ErreurAnnuaire(`Annuaire des entreprises indisponible (HTTP ${res.status}).`);
    return res.json().catch(() => {
      throw new ErreurAnnuaire('Réponse de l’annuaire illisible.');
    });
  };

  const chercher: ClientAnnuaire['chercher'] = (recherche, opts = {}) => {
    const params = new URLSearchParams({ q: recherche, per_page: String(opts.limite ?? 5) });
    if (opts.departement) params.set('departement', opts.departement);
    const suite = file.then(() => appeler(`${URL_RECHERCHE}?${params.toString()}`));
    file = suite.catch(() => undefined);
    return suite.then((json) => {
      const lu = reponseApi.safeParse(json);
      if (!lu.success) throw new ErreurAnnuaire('Réponse de l’annuaire illisible.');
      return lu.data.results.map(convertir);
    });
  };

  return {
    chercher,
    async parSiren(siren) {
      const chiffres = siren.replace(/\s/g, '');
      if (!/^\d{9}$/.test(chiffres))
        throw new ErreurAnnuaire('SIREN invalide : 9 chiffres attendus.');
      const [trouvee] = await chercher(chiffres, { limite: 1 });
      return trouvee?.siren === chiffres ? trouvee : null;
    },
  };
}
