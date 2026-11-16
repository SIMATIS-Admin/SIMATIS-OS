import { and, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { coutEquivalent, type Jetons } from './cout.js';
import {
  FOURNISSEURS_IA,
  iaCumuls,
  iaJauges,
  iaLancements,
  iaReleve,
  iaSessions,
  OUTILS_IA,
  type FournisseurConso,
} from './schema.js';

const iso = z.iso.datetime({ offset: true });
const entier = z.number().int().min(0);

const sessionReleve = z.object({
  id: z.string().min(1).max(200),
  fournisseur: z.enum(FOURNISSEURS_IA),
  outil: z.enum(OUTILS_IA),
  sujet: z.string().min(1).max(200),
  branche: z.string().max(200).nullable(),
  titre: z.string().max(300).nullable(),
  cwd: z.string().max(1000).nullable(),
  debut: iso,
});
const cumulReleve = z.object({
  sessionId: z.string().min(1).max(200),
  heure: iso,
  modele: z.string().min(1).max(100),
  entree: entier,
  sortie: entier,
  cacheEcriture: entier,
  cacheLecture: entier,
});
const jaugeReleve = z.object({
  fournisseur: z.literal('chatgpt'),
  at: iso,
  utilise5h: z.number().min(0).max(100),
  utiliseHebdo: z.number().min(0).max(100),
  reset5h: iso.nullable(),
  resetHebdo: iso.nullable(),
});

export const releveSchema = z.object({
  passage: iso,
  anomalies: entier,
  detail: z.string().max(1000).optional(),
  sessions: z.array(sessionReleve).max(5000),
  cumuls: z.array(cumulReleve).max(5000),
  jauges: z.array(jaugeReleve).max(5000),
});
export const lancementSchema = z.object({
  moteur: z.enum(['claude', 'codex']),
  sessionId: z.string().min(1).max(200).optional(),
  cwd: z.string().min(1).max(1000).optional(),
  debut: iso.optional(),
  sujet: z.string().min(1).max(200),
});

export type SessionReleve = z.infer<typeof sessionReleve>;
export type CumulReleve = z.infer<typeof cumulReleve>;
export type JaugeReleve = z.infer<typeof jaugeReleve>;
export type Releve = z.infer<typeof releveSchema>;
export type { Jetons };

export const SUJET_INT_INCONNU = 'Lancement de l’OS non identifié';
// Un lancement Codex se reconnaît à son dossier de travail et à son heure de départ.
const ECART_CODEX_MS = 60_000;
const PAQUET = 1000;

const paquets = <T>(liste: T[]) =>
  Array.from({ length: Math.ceil(liste.length / PAQUET) }, (_, i) =>
    liste.slice(i * PAQUET, (i + 1) * PAQUET),
  );

export async function declarerLancement(
  db: Database,
  l: { moteur: 'claude' | 'codex'; sessionId?: string; cwd?: string; debut: string; sujet: string },
): Promise<{ id: string }> {
  const [ligne] = await db
    .insert(iaLancements)
    .values({
      moteur: l.moteur,
      sessionId: l.sessionId ?? null,
      cwd: l.cwd ?? null,
      debut: new Date(l.debut),
      sujet: l.sujet,
    })
    .returning({ id: iaLancements.id });
  if (!ligne) throw new Error('Lancement non enregistré');
  return ligne;
}

async function origines(db: Database, sessions: SessionReleve[]) {
  const ids = sessions.map((s) => s.id.slice(s.id.indexOf(':') + 1));
  const cwds = sessions.flatMap((s) => (s.cwd ? [s.cwd] : []));
  const parSession =
    ids.length > 0
      ? await db.select().from(iaLancements).where(inArray(iaLancements.sessionId, ids))
      : [];
  const parCwd =
    cwds.length > 0
      ? await db.select().from(iaLancements).where(inArray(iaLancements.cwd, cwds))
      : [];
  return (s: SessionReleve): { origine: 'ext' | 'int'; sujet: string } => {
    const id = s.id.slice(s.id.indexOf(':') + 1);
    const debut = new Date(s.debut).getTime();
    const lancement =
      parSession.find((l) => l.sessionId === id) ??
      parCwd.find(
        (l) =>
          l.moteur === 'codex' &&
          l.cwd === s.cwd &&
          Math.abs(l.debut.getTime() - debut) <= ECART_CODEX_MS,
      );
    if (lancement) return { origine: 'int', sujet: lancement.sujet };
    if (s.outil === 'executeur') return { origine: 'int', sujet: SUJET_INT_INCONNU };
    return { origine: 'ext', sujet: s.sujet };
  };
}

export async function enregistrerReleve(db: Database, r: Releve): Promise<void> {
  const classer = await origines(db, r.sessions);
  const fournisseurs = new Map<string, FournisseurConso>(
    r.sessions.map((s) => [s.id, s.fournisseur]),
  );
  const inconnues = [...new Set(r.cumuls.map((c) => c.sessionId))].filter(
    (id) => !fournisseurs.has(id),
  );
  if (inconnues.length > 0) {
    const connues = await db
      .select({ id: iaSessions.id, fournisseur: iaSessions.fournisseur })
      .from(iaSessions)
      .where(inArray(iaSessions.id, inconnues));
    for (const s of connues) fournisseurs.set(s.id, s.fournisseur);
  }

  await db.transaction(async (tx) => {
    for (const lot of paquets(r.sessions)) {
      await tx
        .insert(iaSessions)
        .values(
          lot.map((s) => ({
            id: s.id,
            fournisseur: s.fournisseur,
            outil: s.outil,
            ...classer(s),
            branche: s.branche,
            titre: s.titre,
            cwd: s.cwd,
            debut: new Date(s.debut),
            vuLe: new Date(r.passage),
          })),
        )
        .onConflictDoUpdate({
          target: iaSessions.id,
          set: {
            outil: sql`excluded.outil`,
            origine: sql`excluded.origine`,
            sujet: sql`excluded.sujet`,
            branche: sql`excluded.branche`,
            titre: sql`excluded.titre`,
            cwd: sql`excluded.cwd`,
            debut: sql`least(${iaSessions.debut}, excluded.debut)`,
            vuLe: sql`excluded.vu_le`,
          },
        });
    }
    // Un cumul dont la session n'est connue nulle part est ignoré : il reviendra au relevé suivant.
    const cumuls = r.cumuls.flatMap((c) => {
      const fournisseur = fournisseurs.get(c.sessionId);
      if (!fournisseur) return [];
      const { cout } = coutEquivalent(fournisseur, c.modele, c);
      return [{ ...c, heure: new Date(c.heure), cout }];
    });
    for (const lot of paquets(cumuls)) {
      await tx
        .insert(iaCumuls)
        .values(lot)
        .onConflictDoUpdate({
          target: [iaCumuls.sessionId, iaCumuls.heure, iaCumuls.modele],
          set: {
            entree: sql`excluded.entree`,
            sortie: sql`excluded.sortie`,
            cacheEcriture: sql`excluded.cache_ecriture`,
            cacheLecture: sql`excluded.cache_lecture`,
            cout: sql`excluded.cout`,
          },
        });
    }
    for (const lot of paquets(r.jauges)) {
      await tx
        .insert(iaJauges)
        .values(
          lot.map((j) => ({
            fournisseur: j.fournisseur,
            at: new Date(j.at),
            source: 'codex' as const,
            utilise5h: j.utilise5h,
            utiliseHebdo: j.utiliseHebdo,
            reset5h: j.reset5h ? new Date(j.reset5h) : null,
            resetHebdo: j.resetHebdo ? new Date(j.resetHebdo) : null,
          })),
        )
        .onConflictDoNothing();
    }
    await tx
      .insert(iaReleve)
      .values({
        id: 'mac',
        dernierPassage: new Date(r.passage),
        anomalies: r.anomalies,
        detail: r.detail ?? null,
      })
      .onConflictDoUpdate({
        target: iaReleve.id,
        set: {
          dernierPassage: sql`excluded.dernier_passage`,
          anomalies: sql`excluded.anomalies`,
          detail: sql`excluded.detail`,
        },
      });
  });
}

// Lu par la console et l'archive : les cumuls d'une période, avec la session qui les porte.
export async function cumulsEntre(db: Pick<Database, 'select'>, depuis: Date, jusqua: Date) {
  return db
    .select({
      heure: iaCumuls.heure,
      modele: iaCumuls.modele,
      entree: iaCumuls.entree,
      sortie: iaCumuls.sortie,
      cacheEcriture: iaCumuls.cacheEcriture,
      cacheLecture: iaCumuls.cacheLecture,
      cout: iaCumuls.cout,
      fournisseur: iaSessions.fournisseur,
      outil: iaSessions.outil,
      origine: iaSessions.origine,
      sujet: iaSessions.sujet,
      sessionId: iaCumuls.sessionId,
    })
    .from(iaCumuls)
    .innerJoin(iaSessions, sql`${iaSessions.id} = ${iaCumuls.sessionId}`)
    .where(and(gte(iaCumuls.heure, depuis), lte(iaCumuls.heure, jusqua)));
}
