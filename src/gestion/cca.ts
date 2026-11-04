import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { IkIntrouvable, IkInvalide } from './ik.js';
import { ETATS_CCA, gestionCcaMouvements, TYPES_CCA } from './schema.js';

const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const mouvementSchema = z.object({
  date: jour,
  type: z.enum(TYPES_CCA),
  libelle: z.string().trim().min(1).max(200),
  // Signé : positif = crédit du compte d'associé, négatif = débit.
  montantCents: z.number().int().min(-100_000_000_00).max(100_000_000_00),
  etat: z.enum(ETATS_CCA).default('prevu'),
  source: z.string().trim().max(300).nullish(),
});

const visible = and(
  eq(gestionCcaMouvements.instanceId, currentInstance),
  isNull(gestionCcaMouvements.archiveeAt),
);

export async function creerMouvement(
  tx: Executor,
  instanceId: string,
  m: z.infer<typeof mouvementSchema>,
) {
  if (m.etat === 'comptabilise' && !m.source?.trim())
    throw new IkInvalide('Un mouvement comptabilisé a besoin de sa source (écriture, relevé).');
  if (m.type === 'ouverture') {
    if (m.etat !== 'comptabilise')
      throw new IkInvalide("Le solde d'ouverture doit être confirmé par le comptable.");
    const [deja] = await tx
      .select({ id: gestionCcaMouvements.id })
      .from(gestionCcaMouvements)
      .where(and(visible, eq(gestionCcaMouvements.type, 'ouverture')));
    if (deja)
      throw new IkInvalide("Le solde d'ouverture existe déjà : corrigez-le par un mouvement.");
  }
  const [l] = await tx
    .insert(gestionCcaMouvements)
    .values({ ...m, source: m.source ?? null, instanceId })
    .returning();
  return l!;
}

// Un mouvement prévu devient comptabilisé quand le comptable l'a écrit : la source est exigée.
export async function comptabiliserMouvement(tx: Executor, id: string, source: string) {
  if (!source.trim()) throw new IkInvalide('La source est obligatoire.');
  const [l] = await tx
    .update(gestionCcaMouvements)
    .set({ etat: 'comptabilise', source, updatedAt: new Date() })
    .where(and(visible, eq(gestionCcaMouvements.id, id), eq(gestionCcaMouvements.etat, 'prevu')))
    .returning();
  if (!l) throw new IkIntrouvable('Mouvement prévu introuvable');
  return l;
}

export async function archiverMouvement(tx: Executor, id: string) {
  const [m] = await tx
    .select()
    .from(gestionCcaMouvements)
    .where(and(visible, eq(gestionCcaMouvements.id, id)));
  if (!m) throw new IkIntrouvable('Mouvement introuvable');
  if (m.refSource)
    throw new IkInvalide("Ce mouvement vient des IK : il ne s'efface pas à la main.");
  await tx
    .update(gestionCcaMouvements)
    .set({ archiveeAt: new Date() })
    .where(eq(gestionCcaMouvements.id, id));
}

export type SuiviCca = {
  // null = pas de solde d'ouverture confirmé : jamais zéro par défaut.
  confirmeCents: number | null;
  // Confirmé + mouvements prévus ; toujours présenté comme une estimation.
  estimeCents: number | null;
  ouverture: { date: string; montantCents: number; source: string | null } | null;
  mouvements: {
    id: string;
    date: string;
    type: (typeof TYPES_CCA)[number];
    libelle: string;
    montantCents: number;
    etat: (typeof ETATS_CCA)[number];
    source: string | null;
    derive: boolean;
    avantOuverture: boolean;
  }[];
  avertissements: string[];
};

export async function suiviCca(tx: Executor): Promise<SuiviCca> {
  const lignes = await tx
    .select()
    .from(gestionCcaMouvements)
    .where(visible)
    .orderBy(asc(gestionCcaMouvements.date), asc(gestionCcaMouvements.createdAt));
  const ouv = lignes.find((l) => l.type === 'ouverture') ?? null;
  const mouvements = lignes.map((l) => ({
    id: l.id,
    date: l.date,
    type: l.type,
    libelle: l.libelle,
    montantCents: l.montantCents,
    etat: l.etat,
    source: l.source,
    derive: l.refSource != null,
    // Antérieur à l'ouverture : déjà compris dans ce solde, donc écarté du calcul.
    avantOuverture: ouv != null && l.type !== 'ouverture' && l.date < ouv.date,
  }));
  const comptes = mouvements.filter((m) => !m.avantOuverture);
  const somme = (etats: string[]) =>
    comptes.filter((m) => etats.includes(m.etat)).reduce((s, m) => s + m.montantCents, 0);
  const avertissements: string[] = [];
  if (!ouv)
    avertissements.push(
      "Solde d'ouverture non renseigné : à faire confirmer par le comptable. Le solde n'est pas calculé.",
    );
  if (mouvements.some((m) => m.avantOuverture))
    avertissements.push("Des mouvements antérieurs à l'ouverture sont écartés du solde.");
  return {
    confirmeCents: ouv ? somme(['comptabilise']) : null,
    estimeCents: ouv ? somme(['comptabilise', 'prevu']) : null,
    ouverture: ouv ? { date: ouv.date, montantCents: ouv.montantCents, source: ouv.source } : null,
    mouvements,
    avertissements,
  };
}
