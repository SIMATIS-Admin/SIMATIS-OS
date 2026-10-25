import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { profilDe, type Profil } from './profil.js';
import { entreprises } from '../crm/schema.js';
import { genererRapportWord, nomFichier } from './rapport-word.js';
import { diagnosticProjets, type Projet } from './schema.js';

// Le diagnostic est un outil de SIMATIS seulement : un mandat ne le voit pas (il verra son résultat).
export class DiagnosticIndisponible extends Error {}
export class ProjetIntrouvable extends Error {}
export class EntrepriseIntrouvable extends Error {
  constructor() {
    super('Entreprise introuvable dans cet espace');
  }
}

export type ProjetVue = Omit<Projet, 'rapport' | 'logo' | 'pdfEntretien' | 'rapportVersions'> & {
  profil: Profil | null;
  // Versions du rapport (sans contenu) : chacune se télécharge à part.
  rapportVersions: { version: number; le: string }[];
  aRapport: boolean;
  aLogo: boolean;
  aPdfEntretien: boolean;
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
    | 'restitutionAvecProposition'
  >
> & { logo?: { nom: string; base64: string } | null };

export const verifierEspace = (instance: Instance) => {
  if (instance.type !== 'propre')
    throw new DiagnosticIndisponible("Le diagnostic est réservé à l'espace SIMATIS.");
};

// Le rapport et le logo (base64) ne voyagent pas avec la liste : ils se téléchargent à part.
export const vue = ({
  rapport,
  logo,
  pdfEntretien,
  rapportVersions,
  ...projet
}: Projet): ProjetVue => ({
  ...projet,
  rapportVersions: rapportVersions.map(({ version, le }) => ({ version, le })),
  profil: projet.dims ? profilDe(projet.dims) : null,
  aRapport: rapport !== null,
  aLogo: logo !== null,
  aPdfEntretien: pdfEntretien !== null,
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
  input: { nom: string; activite: string; entrepriseId?: string | null },
): Promise<ProjetVue> {
  verifierEspace(instance);
  return withInstance(db, instance.id, async (tx) => {
    // Une entreprise d'une autre instance est invisible ici (RLS) : elle n'est donc pas trouvée.
    if (input.entrepriseId) {
      const [trouvee] = await tx
        .select({ id: entreprises.id })
        .from(entreprises)
        .where(eq(entreprises.id, input.entrepriseId));
      if (!trouvee) throw new EntrepriseIntrouvable();
    }
    const [row] = await tx
      .insert(diagnosticProjets)
      .values({
        instanceId: instance.id,
        nom: input.nom.trim(),
        activite: input.activite,
        entrepriseId: input.entrepriseId ?? null,
      })
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

// Suppression définitive : le rapport, le PDF et la conversation partent avec le projet.
export async function deleteProjet(db: Executor, instance: Instance, id: string): Promise<void> {
  verifierEspace(instance);
  await withInstance(db, instance.id, async (tx) => {
    const supprimes = await tx
      .delete(diagnosticProjets)
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)))
      .returning({ id: diagnosticProjets.id });
    if (supprimes.length === 0)
      throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  });
}

// Le Word du rapport : la dernière version par défaut, ou une version précédente (régénérée depuis
// son contenu).
export async function rapportDe(
  db: Executor,
  instance: Instance,
  id: string,
  version?: number,
): Promise<{ nom: string; contenu: Buffer }> {
  verifierEspace(instance);
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .select({
        rapport: diagnosticProjets.rapport,
        nom: diagnosticProjets.rapportNom,
        versions: diagnosticProjets.rapportVersions,
      })
      .from(diagnosticProjets)
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)));
    if (!row) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
    if (version !== undefined && version !== row.versions.at(-1)?.version) {
      const v = row.versions.find((x) => x.version === version);
      if (!v) throw new ProjetIntrouvable('Version du rapport introuvable');
      return {
        nom: nomFichier(v.contenu.entreprise, v.version),
        contenu: Buffer.from(genererRapportWord(v.contenu)),
      };
    }
    if (!row.rapport || !row.nom) throw new ProjetIntrouvable('Aucun rapport pour ce projet');
    return { nom: row.nom, contenu: Buffer.from(row.rapport, 'base64') };
  });
}
