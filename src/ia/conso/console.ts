import { and, eq, gte, lte } from 'drizzle-orm';
import type { Executor } from '../../db.js';
import type { LigneConsole } from '../../console/service.js';
import {
  coefficient,
  hausseParHeure,
  nonAttribue,
  type Coefficient,
  type PointJauge,
} from './calibrage.js';
import type { Jetons } from './cout.js';
import { iaJauges, iaReleve, type FournisseurConso } from './schema.js';
import { cumulsEntre } from './service.js';

export type LigneHeure = {
  heure: Date;
  origine: 'ext' | 'int' | 'non_attribue';
  fournisseur: FournisseurConso;
  outil: string;
  sujet: string;
  jetons: Jetons;
  cout: number;
  l5: number | null;
  lh: number | null;
  estime: boolean;
};

const HEURE_MS = 3_600_000;
const CALIBRAGE_MS = 14 * 24 * HEURE_MS;
const FENETRE_MS = 24 * HEURE_MS;
const SEUIL_ALERTE_L5 = 10;
const RELEVE_MUET_MS = 15 * 60_000;
// Coût d'un million de jetons d'entrée de Sonnet 5.5 : sert à dire « 1,2 M jetons » tant que les
// jauges n'ont pas encore permis de calibrer.
const COUT_MILLION_REFERENCE = 2;

const debutHeure = (d: Date) => new Date(Math.floor(d.getTime() / HEURE_MS) * HEURE_MS);
const arrondi = (x: number) => Math.round(x * 10) / 10;

function heuresEntre(depuis: Date, jusqua: Date): Date[] {
  const heures: Date[] = [];
  for (let t = debutHeure(depuis).getTime(); t <= jusqua.getTime(); t += HEURE_MS)
    heures.push(new Date(t));
  return heures;
}

type Calibrage = {
  l5: Coefficient;
  lh: Coefficient;
  hausses5: Map<number, number | null>;
  haussesH: Map<number, number | null>;
  couts: Map<number, number>;
};

async function calibrer(
  db: Executor,
  maintenant: Date,
): Promise<Record<FournisseurConso, Calibrage>> {
  const depuis = new Date(maintenant.getTime() - CALIBRAGE_MS);
  const cumuls = await cumulsEntre(db, depuis, maintenant);
  // Un relevé antérieur à la période sert de point de départ à sa première heure.
  const points = await db
    .select()
    .from(iaJauges)
    .where(
      and(gte(iaJauges.at, new Date(depuis.getTime() - HEURE_MS)), lte(iaJauges.at, maintenant)),
    );
  const heures = heuresEntre(depuis, maintenant);
  const pour = (fournisseur: FournisseurConso): Calibrage => {
    const couts = new Map<number, number>();
    for (const c of cumuls)
      if (c.fournisseur === fournisseur)
        couts.set(c.heure.getTime(), (couts.get(c.heure.getTime()) ?? 0) + c.cout);
    const siens = points.filter((p) => p.fournisseur === fournisseur);
    const serie = (cle: 'utilise5h' | 'utiliseHebdo', reset: 'reset5h' | 'resetHebdo') =>
      siens.map((p): PointJauge => ({ at: p.at, utilise: p[cle], reset: p[reset] }));
    const hausses5 = hausseParHeure(serie('utilise5h', 'reset5h'), heures);
    const haussesH = hausseParHeure(serie('utiliseHebdo', 'resetHebdo'), heures);
    return {
      l5: coefficient(hausses5, couts),
      lh: coefficient(haussesH, couts),
      hausses5,
      haussesH,
      couts,
    };
  };
  return { claude: pour('claude'), chatgpt: pour('chatgpt') };
}

export async function lignesHeures(
  db: Executor,
  depuis: Date,
  jusqua: Date,
  maintenant: Date,
): Promise<LigneHeure[]> {
  const calibrage = await calibrer(db, maintenant);
  const cumuls = await cumulsEntre(db, debutHeure(depuis), jusqua);
  const groupes = new Map<string, LigneHeure>();
  for (const c of cumuls) {
    const cle = [c.heure.toISOString(), c.origine, c.fournisseur, c.outil, c.sujet].join('|');
    const g = groupes.get(cle) ?? {
      heure: c.heure,
      origine: c.origine,
      fournisseur: c.fournisseur,
      outil: c.outil,
      sujet: c.sujet,
      jetons: { entree: 0, sortie: 0, cacheEcriture: 0, cacheLecture: 0 },
      cout: 0,
      l5: null,
      lh: null,
      estime: false,
    };
    g.jetons.entree += c.entree;
    g.jetons.sortie += c.sortie;
    g.jetons.cacheEcriture += c.cacheEcriture;
    g.jetons.cacheLecture += c.cacheLecture;
    g.cout += c.cout;
    groupes.set(cle, g);
  }
  const lignes = [...groupes.values()].map((g) => {
    const { l5, lh } = calibrage[g.fournisseur];
    return {
      ...g,
      l5: l5 ? arrondi(l5.k * g.cout) : null,
      lh: lh ? arrondi(lh.k * g.cout) : null,
      estime: Boolean(l5?.estime ?? lh?.estime),
    };
  });
  // Le « non attribué » ne concerne que Claude : côté ChatGPT, la jauge lue est celle de Codex,
  // que le relevé voit en entier. Seulement pour les heures que le relevé du Mac a entièrement
  // couvertes : sinon une session pas encore relevée passerait pour du Chat.
  const c = calibrage.claude;
  const [releve] = await db.select().from(iaReleve).where(eq(iaReleve.id, 'mac'));
  const couvertJusqua = releve?.dernierPassage.getTime() ?? 0;
  for (const heure of heuresEntre(depuis, jusqua)) {
    const t = heure.getTime();
    if (t + HEURE_MS > couvertJusqua) continue;
    const cout = c.couts.get(t) ?? 0;
    const na5 = nonAttribue(c.hausses5.get(t) ?? null, cout, c.l5);
    const naH = nonAttribue(c.haussesH.get(t) ?? null, cout, c.lh);
    if ((na5 ?? 0) >= 1 || (naH ?? 0) >= 1)
      lignes.push({
        heure,
        origine: 'non_attribue',
        fournisseur: 'claude',
        outil: '',
        sujet: 'non attribué',
        jetons: { entree: 0, sortie: 0, cacheEcriture: 0, cacheLecture: 0 },
        cout: 0,
        l5: na5,
        lh: naH,
        estime: Boolean(c.l5?.estime ?? c.lh?.estime),
      });
  }
  return lignes.sort((a, b) => a.heure.getTime() - b.heure.getTime());
}

const decimale = (x: number) =>
  x.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function quantite(l: LigneHeure): string {
  const parts: string[] = [];
  const signe = l.estime ? '≈ +' : '+';
  if (l.l5 !== null) parts.push(`L5 ${signe}${decimale(l.l5)} %`);
  if (l.lh !== null) parts.push(`LH ${signe}${decimale(l.lh)} %`);
  if (parts.length > 0) return parts.join(' · ');
  const jetons = (l.cout / COUT_MILLION_REFERENCE) * 1e6;
  if (jetons >= 1e6) return `${decimale(jetons / 1e6)} M jetons`;
  if (jetons >= 1e3) return `${Math.round(jetons / 1e3)} k jetons`;
  return `${Math.round(jetons)} jetons`;
}

const NOMS: Record<FournisseurConso, string> = { claude: 'Claude', chatgpt: 'ChatGPT' };
const OUTILS: Record<string, string> = {
  code: 'Code',
  cowork: 'Cowork',
  codex: 'Codex',
  agent: 'Agent',
};

export function texteLigne(l: LigneHeure): string {
  if (l.origine === 'non_attribue')
    return `${NOMS[l.fournisseur]} · non attribué (Chat claude.ai ?) · ${quantite(l)}`;
  // L'exécuteur lance Claude Code (claude -p) ou Codex (codex exec).
  const outil =
    l.outil === 'executeur' ? (l.fournisseur === 'claude' ? 'Code' : 'Codex') : OUTILS[l.outil];
  const origine = l.origine === 'int' ? 'IA-int' : 'IA-ext';
  return `${origine} · ${NOMS[l.fournisseur]} · ${outil ?? l.outil} · ${l.sujet} · ${quantite(l)}`;
}

const heureParis = (d: Date) =>
  d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

export async function lignesConso(db: Executor, maintenant: Date): Promise<LigneConsole[]> {
  const depuis = new Date(maintenant.getTime() - FENETRE_MS);
  const lignes: LigneConsole[] = (await lignesHeures(db, depuis, maintenant, maintenant)).map(
    (l) => ({
      id: `conso:${l.heure.toISOString()}:${l.origine}:${l.fournisseur}:${l.outil}:${l.sujet}`,
      at: l.heure.toISOString(),
      source: 'conso',
      acteur: 'ia',
      niveau: (l.l5 ?? 0) >= SEUIL_ALERTE_L5 ? 'attention' : 'info',
      texte: texteLigne(l),
    }),
  );
  const [releve] = await db.select().from(iaReleve).where(eq(iaReleve.id, 'mac'));
  if (releve) {
    const muetDepuis = releve.dernierPassage.getTime() + RELEVE_MUET_MS;
    if (muetDepuis <= maintenant.getTime())
      lignes.push({
        id: 'conso:muet',
        at: new Date(muetDepuis).toISOString(),
        source: 'conso',
        acteur: 'ia',
        niveau: 'attention',
        texte: `Relevé de consommation IA muet depuis ${heureParis(releve.dernierPassage)} : vérifiez l'exécuteur sur le Mac.`,
      });
    if (releve.anomalies > 0)
      lignes.push({
        id: `conso:anomalies:${releve.dernierPassage.toISOString()}`,
        at: releve.dernierPassage.toISOString(),
        source: 'conso',
        acteur: 'ia',
        niveau: 'attention',
        texte: `Relevé de consommation IA : ${releve.anomalies} lignes illisibles (format des fichiers changé ?).`,
      });
  }
  return lignes;
}
