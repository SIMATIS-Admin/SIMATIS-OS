import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { profilDe, type Profil } from './profil.js';
import { diagnosticProjets, type Projet } from './schema.js';

// Le diagnostic est un outil de SIMATIS seulement : un mandat ne le voit pas (il verra son résultat).
export class DiagnosticIndisponible extends Error {}
export class ProjetIntrouvable extends Error {}

export type ProjetVue = Omit<Projet, 'rapport' | 'logo'> & {
  profil: Profil | null;
  aRapport: boolean;
  aLogo: boolean;
};
export type ProjetPatch = Partial<
  Pick<
    Projet,
    | 'nom'
    | 'activite'
    | 'contexte'
    | 'etape'
    | 'dims'
    | 'statutDiagnostic'
    | 'dateDiagnostic'
    | 'chats'
    | 'revue'
    | 'ditParDirigeant'
    | 'hypotheses'
  >
> & { logo?: { nom: string; base64: string } | null };

export const verifierEspace = (instance: Instance) => {
  if (instance.type !== 'propre')
    throw new DiagnosticIndisponible("Le diagnostic est réservé à l'espace SIMATIS.");
};

// Le rapport et le logo (base64) ne voyagent pas avec la liste : ils se téléchargent à part.
export const vue = ({ rapport, logo, ...projet }: Projet): ProjetVue => ({
  ...projet,
  profil: projet.dims ? profilDe(projet.dims) : null,
  aRapport: rapport !== null,
  aLogo: logo !== null,
});

export async function listProjets(db: Executor, instance: Instance): Promise<ProjetVue[]> {
  verifierEspace(instance);
  return withInstance(db, instance.id, async (tx) => {
    const rows = await tx
      .select()
      .from(diagnosticProjets)
      .where(eq(diagnosticProjets.instanceId, instance.id))
      .orderBy(desc(diagnosticProjets.updatedAt));
    return rows.map(vue);
  });
}

export async function createProjet(
  db: Executor,
  instance: Instance,
  input: { nom: string; activite: string },
): Promise<ProjetVue> {
  verifierEspace(instance);
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .insert(diagnosticProjets)
      .values({ instanceId: instance.id, nom: input.nom.trim(), activite: input.activite })
      .returning();
    return vue(row!);
  });
}

export async function updateProjet(
  db: Executor,
  instance: Instance,
  id: string,
  { logo, ...patch }: ProjetPatch,
): Promise<ProjetVue> {
  verifierEspace(instance);
  const colonnesLogo =
    logo === undefined ? {} : { logo: logo?.base64 ?? null, logoNom: logo?.nom ?? null };
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .update(diagnosticProjets)
      .set({
        ...patch,
        ...colonnesLogo,
        ...(patch.etape === undefined
          ? {}
          : { etapeMax: sql`greatest(${diagnosticProjets.etapeMax}, ${patch.etape})` }),
        updatedAt: new Date(),
      })
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)))
      .returning();
    if (!row) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
    return vue(row);
  });
}

export async function rapportDe(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<{ nom: string; contenu: Buffer }> {
  verifierEspace(instance);
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .select({ rapport: diagnosticProjets.rapport, nom: diagnosticProjets.rapportNom })
      .from(diagnosticProjets)
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)));
    if (!row) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
    if (!row.rapport || !row.nom) throw new ProjetIntrouvable('Aucun rapport pour ce projet');
    return { nom: row.nom, contenu: Buffer.from(row.rapport, 'base64') };
  });
}
