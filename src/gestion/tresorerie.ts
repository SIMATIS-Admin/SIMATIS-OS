import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { jourDe } from '../pilotage/realisees.js';
import { occurrencesRevenus, type OccurrenceRevenu } from './revenus.js';
import { gestionReglages, MODES_SEUIL, type ModeSeuil } from './schema.js';
import { occurrencesDepenses, type OccurrenceVue } from './service.js';

export const SCENARIOS = ['securise', 'central', 'ambitieux'] as const;
export type Scenario = (typeof SCENARIOS)[number];
// Quelles recettes entrent dans chaque scénario : le sécurisé ne retient que le certain.
const CERTITUDES_RETENUES: Record<Scenario, string[]> = {
  securise: ['certaine'],
  central: ['certaine', 'probable'],
  ambitieux: ['certaine', 'probable', 'hypothese'],
};

export type Reglages = {
  soldeCents: number | null;
  soldeDate: string | null;
  soldeSource: string | null;
  seuilMode: ModeSeuil;
  seuilCents: number | null;
  delaiPaiementJours: number | null;
};
export const REGLAGES_VIDES: Reglages = {
  soldeCents: null,
  soldeDate: null,
  soldeSource: null,
  seuilMode: 'aucun',
  seuilCents: null,
  delaiPaiementJours: null,
};

export class ReglagesInvalides extends Error {}

const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const reglagesSchema = z.object({
  soldeCents: z.number().int().nullable(),
  soldeDate: jour.nullable(),
  soldeSource: z.string().trim().max(200).nullable(),
  seuilMode: z.enum(MODES_SEUIL),
  seuilCents: z.number().int().min(0).nullable(),
  delaiPaiementJours: z.number().int().min(0).max(365).nullable(),
});

function verifierReglages(r: Reglages) {
  // Un solde n'a de sens qu'avec sa date et sa source.
  if (r.soldeCents != null && (!r.soldeDate || !r.soldeSource))
    throw new ReglagesInvalides('Le solde demande une date et une source');
  if (r.soldeCents == null && (r.soldeDate || r.soldeSource))
    throw new ReglagesInvalides('Une date ou une source sans solde ne veut rien dire');
  if (r.seuilMode === 'montant' && r.seuilCents == null)
    throw new ReglagesInvalides(
      "Le seuil en montant doit être renseigné : il n'a pas de valeur par défaut",
    );
}

export async function lireReglages(tx: Executor): Promise<Reglages> {
  const [l] = await tx
    .select()
    .from(gestionReglages)
    .where(eq(gestionReglages.instanceId, currentInstance));
  if (!l) return { ...REGLAGES_VIDES };
  return {
    soldeCents: l.soldeCents,
    soldeDate: l.soldeDate,
    soldeSource: l.soldeSource,
    seuilMode: l.seuilMode,
    seuilCents: l.seuilCents,
    delaiPaiementJours: l.delaiPaiementJours,
  };
}

export async function ecrireReglages(tx: Executor, instanceId: string, r: Reglages) {
  verifierReglages(r);
  const valeurs = { ...r, seuilCents: r.seuilMode === 'montant' ? r.seuilCents : null };
  await tx
    .insert(gestionReglages)
    .values({ instanceId, ...valeurs })
    .onConflictDoUpdate({
      target: gestionReglages.instanceId,
      set: { ...valeurs, updatedAt: new Date() },
    });
  return lireReglages(tx);
}

// --- Moteur : fonctions pures, testées sans base ---------------------------------------------------

export type Mouvement = {
  date: string;
  sens: 'entree' | 'sortie';
  libelle: string;
  montantCents: number;
  nature: 'depense' | 'recette';
  ref: string;
  // Montant HT faute de TVA renseignée, ou date d'encaissement supposée : à ne pas lire comme certain.
  estime: boolean;
  // Raison lisible de la date retenue (retard, délai de paiement…).
  note: string | null;
};

const ajouterJours = (jourIso: string, n: number) => {
  const d = new Date(`${jourIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const plusTard = (a: string, b: string) => (a > b ? a : b);

// Sorties : TTC, à la date de paiement. Une dépense avancée par l'associé ou créditée à son compte
// (loyer, par exemple) ne sort pas du compte bancaire de la société.
export function mouvementsDepenses(
  occ: OccurrenceVue[],
  soldeDate: string | null,
  aujourdhui: string,
): { mouvements: Mouvement[]; ignorees: number } {
  const mouvements: Mouvement[] = [];
  let ignorees = 0;
  for (const o of occ) {
    if (o.etat === 'ignoree' || o.payeur === 'associe') continue;
    // Sans solde, seul l'avenir est projeté ; avec un solde, seuls les flux postérieurs à sa date.
    const apres = soldeDate ?? ajouterJours(aujourdhui, -1);
    const dateOrigine = o.cle.split('|')[1]!;
    if (o.etat === 'payee') {
      if (!soldeDate || o.date <= soldeDate) continue;
      mouvements.push(sortie(o, o.date, null));
      continue;
    }
    if (dateOrigine <= apres) {
      ignorees += 1;
      continue;
    }
    const effectif = plusTard(o.date, aujourdhui);
    mouvements.push(
      sortie(
        o,
        effectif,
        effectif !== o.date ? 'Échéance dépassée, comptée à la date du jour' : null,
      ),
    );
  }
  return { mouvements, ignorees };
}
const sortie = (o: OccurrenceVue, date: string, note: string | null): Mouvement => ({
  date,
  sens: 'sortie',
  libelle: o.libelle,
  montantCents: o.montantTtcCents,
  nature: 'depense',
  ref: o.cle,
  estime: o.etat !== 'payee',
  note,
});

// Entrées : TTC si la TVA est renseignée, sinon HT signalé comme estimé. Encaissement d'une recette non
// encaissée = date de facture + délai de paiement réglé par Marc (aucun délai supposé) + retard simulé.
export function mouvementsRecettes(
  occ: OccurrenceRevenu[],
  p: {
    scenario: Scenario;
    soldeDate: string | null;
    aujourdhui: string;
    delaiJours: number | null;
    retardJours: number;
  },
): { mouvements: Mouvement[]; ignorees: number } {
  const mouvements: Mouvement[] = [];
  let ignorees = 0;
  const retenues = CERTITUDES_RETENUES[p.scenario];
  for (const o of occ) {
    if (o.etat === 'ignoree') continue;
    const montant = o.montantHtCents + (o.tvaCents ?? 0);
    const sansTva = o.tvaCents == null;
    if (o.etat === 'encaissee') {
      if (!p.soldeDate || !o.dateEncaissement || o.dateEncaissement <= p.soldeDate) continue;
      mouvements.push(entree(o, o.dateEncaissement, montant, sansTva, null));
      continue;
    }
    if (!retenues.includes(o.certitude)) continue;
    // Une facture émise reste due même avant la date du solde ; une simple prévision ancienne, non.
    const apres = p.soldeDate ?? ajouterJours(p.aujourdhui, -1);
    if (o.etat === 'prevue' && o.date <= apres) {
      ignorees += 1;
      continue;
    }
    const delai = (p.delaiJours ?? 0) + p.retardJours;
    const cash = ajouterJours(o.date, delai);
    const effectif = plusTard(cash, p.aujourdhui);
    const notes = [
      sansTva ? 'Montant HT : TVA non renseignée' : null,
      p.delaiJours == null
        ? 'Délai de paiement non défini : encaissement supposé à la date de facture'
        : null,
      p.retardJours ? `Retard simulé de ${p.retardJours} jours` : null,
      effectif !== cash ? 'Échéance dépassée, comptée à la date du jour' : null,
    ].filter((n): n is string => !!n);
    mouvements.push({
      ...entree(o, effectif, montant, sansTva, null),
      estime: true,
      note: notes.join(' · ') || null,
    });
  }
  return { mouvements, ignorees };
}
const entree = (
  o: OccurrenceRevenu,
  date: string,
  montantCents: number,
  sansTva: boolean,
  note: string | null,
): Mouvement => ({
  date,
  sens: 'entree',
  libelle: o.libelle,
  montantCents,
  nature: 'recette',
  ref: o.cle,
  estime: sansTva,
  note: note ?? (sansTva ? 'Montant HT : TVA non renseignée' : null),
});

export type Granularite = 'mois' | 'semaine';

// Début de la période (mois ou semaine commençant le lundi) qui contient `date`.
export function debutPeriode(date: string, g: Granularite): string {
  if (g === 'mois') return `${date.slice(0, 7)}-01`;
  const d = new Date(`${date}T00:00:00Z`);
  const retour = (d.getUTCDay() + 6) % 7;
  return ajouterJours(date, -retour);
}
export const periodeSuivante = (debut: string, g: Granularite): string => {
  if (g === 'semaine') return ajouterJours(debut, 7);
  const [a, m] = debut.split('-').map(Number) as [number, number];
  const i = a * 12 + m;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;
};

export type Periode = {
  debut: string;
  fin: string;
  entreesCents: number;
  sortiesCents: number;
  // null tant que le solde d'ouverture n'est pas renseigné : on ne présente pas un zéro inventé.
  soldeFinCents: number | null;
  variationCumuleeCents: number;
  mouvements: Mouvement[];
};

// Agrège les mouvements par période à partir de `debut` jusqu'à la période contenant `fin`.
export function agreger(
  mouvements: Mouvement[],
  p: { solde: number | null; soldeDate: string | null; debut: string; fin: string; g: Granularite },
): Periode[] {
  const tries = [...mouvements].sort((a, b) => a.date.localeCompare(b.date));
  const premiere = debutPeriode(p.debut, p.g);
  const sens = (m: Mouvement) => (m.sens === 'entree' ? m.montantCents : -m.montantCents);
  // Flux entre le solde et la première période affichée : ils changent le point de départ.
  let cumul = tries.filter((m) => m.date < premiere).reduce((t, m) => t + sens(m), 0);
  const periodes: Periode[] = [];
  for (let d = premiere; d <= p.fin; d = periodeSuivante(d, p.g)) {
    const suivante = periodeSuivante(d, p.g);
    const dans = tries.filter((m) => m.date >= d && m.date < suivante);
    const entrees = dans.filter((m) => m.sens === 'entree').reduce((t, m) => t + m.montantCents, 0);
    const sorties = dans.filter((m) => m.sens === 'sortie').reduce((t, m) => t + m.montantCents, 0);
    cumul += entrees - sorties;
    periodes.push({
      debut: d,
      fin: ajouterJours(suivante, -1),
      entreesCents: entrees,
      sortiesCents: sorties,
      soldeFinCents: p.solde == null ? null : p.solde + cumul,
      variationCumuleeCents: cumul,
      mouvements: dans,
    });
  }
  return periodes;
}

// --- BFR strict ------------------------------------------------------------------------------------

export type Bfr = {
  creancesCents: number;
  dettesCents: number;
  bfrCents: number;
  // Seuil d'alerte qui en découle : un BFR négatif ne finance rien, le seuil est alors zéro.
  seuilCents: number;
  limites: string[];
};

// BFR = créances clients (recettes facturées non encaissées) − dettes d'exploitation échues non payées
// (dépenses de la société dont l'échéance est passée). Pas de stocks (activité de services), TVA
// exclue, aucune marge : ce que le calcul ne sait pas est dit dans `limites`.
export function calculerBfr(
  recettes: OccurrenceRevenu[],
  depenses: OccurrenceVue[],
  aujourdhui: string,
  soldeDate: string | null,
): Bfr {
  const creances = recettes
    .filter((o) => o.etat === 'emise')
    .reduce((t, o) => t + o.montantHtCents + (o.tvaCents ?? 0), 0);
  const dettes = depenses
    .filter(
      (o) =>
        o.etat === 'a_venir' &&
        o.payeur === 'societe' &&
        o.cle.split('|')[1]! <= aujourdhui &&
        (!soldeDate || o.cle.split('|')[1]! > soldeDate),
    )
    .reduce((t, o) => t + o.montantTtcCents, 0);
  const sansTva = recettes.filter((o) => o.etat === 'emise' && o.tvaCents == null).length;
  const limites = [
    'Stocks non gérés (activité de services).',
    'TVA à payer exclue du calcul.',
    ...(sansTva ? [`${sansTva} créance(s) comptée(s) hors taxes : TVA non renseignée.`] : []),
  ];
  const bfr = creances - dettes;
  return {
    creancesCents: creances,
    dettesCents: dettes,
    bfrCents: bfr,
    seuilCents: Math.max(0, bfr),
    limites,
  };
}

// --- Assemblage ------------------------------------------------------------------------------------

export type Seuil = {
  mode: ModeSeuil;
  cents: number | null;
  bfr: Bfr | null;
};

export type ProjectionScenario = {
  scenario: Scenario;
  periodes: Periode[];
  // Première période dont le solde de fin passe sous le seuil ; jamais calculée sans solde ni seuil.
  alerte: { debut: string; soldeFinCents: number } | null;
};

export type Projection = {
  aujourdhui: string;
  granularite: Granularite;
  reglages: Reglages;
  seuil: Seuil;
  scenarios: ProjectionScenario[];
  avertissements: string[];
};

export function ajouterMois(jourIso: string, n: number): string {
  const [a, m, j] = jourIso.split('-').map(Number) as [number, number, number];
  const i = a * 12 + (m - 1) + n;
  const annee = Math.floor(i / 12);
  const mois = (i % 12) + 1;
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`;
}

export async function projeter(
  tx: Executor,
  p: {
    horizonMois: number;
    granularite: Granularite;
    retardJours: number;
    aujourdhui?: string;
  },
): Promise<Projection> {
  const aujourdhui = p.aujourdhui ?? jourDe(new Date());
  const reglages = await lireReglages(tx);
  const fin = ajouterMois(aujourdhui, p.horizonMois);
  const depart = '0001-01-01';
  const depenses = await occurrencesDepenses(tx, depart, fin, aujourdhui);
  const recettes = await occurrencesRevenus(tx, depart, fin);
  const sorties = mouvementsDepenses(depenses, reglages.soldeDate, aujourdhui);

  const bfr =
    reglages.seuilMode === 'bfr'
      ? calculerBfr(recettes, depenses, aujourdhui, reglages.soldeDate)
      : null;
  const seuilCents =
    reglages.seuilMode === 'montant' ? reglages.seuilCents : bfr ? bfr.seuilCents : null;

  const avertissements: string[] = [];
  if (reglages.soldeCents == null)
    avertissements.push(
      "Solde d'ouverture non renseigné : seules les variations sont affichées, sans solde de fin.",
    );
  if (reglages.delaiPaiementJours == null)
    avertissements.push(
      'Délai de paiement des clients non défini : les encaissements sont supposés à la date de facture.',
    );
  if (sorties.ignorees)
    avertissements.push(
      `${sorties.ignorees} échéance(s) de dépense antérieure(s) au solde non confirmée(s) : ignorée(s).`,
    );
  if (reglages.seuilMode === 'aucun')
    avertissements.push("Aucun seuil d'alerte réglé : aucune alerte n'est calculée.");

  const scenarios: ProjectionScenario[] = SCENARIOS.map((scenario) => {
    const entrees = mouvementsRecettes(recettes, {
      scenario,
      soldeDate: reglages.soldeDate,
      aujourdhui,
      delaiJours: reglages.delaiPaiementJours,
      retardJours: p.retardJours,
    });
    const periodes = agreger([...sorties.mouvements, ...entrees.mouvements], {
      solde: reglages.soldeCents,
      soldeDate: reglages.soldeDate,
      debut: aujourdhui,
      fin,
      g: p.granularite,
    });
    const sous =
      seuilCents == null
        ? undefined
        : periodes.find((x) => x.soldeFinCents != null && x.soldeFinCents < seuilCents);
    return {
      scenario,
      periodes,
      alerte: sous ? { debut: sous.debut, soldeFinCents: sous.soldeFinCents! } : null,
    };
  });
  return {
    aujourdhui,
    granularite: p.granularite,
    reglages,
    seuil: { mode: reglages.seuilMode, cents: seuilCents, bfr },
    scenarios,
    avertissements,
  };
}
