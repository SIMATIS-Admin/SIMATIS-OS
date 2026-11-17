import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { creerRendezVousDansTx, rdvOsSchema, type CopieAgenda } from '../conversion/rdv.js';
import type { GoogleOptions } from '../connecteurs/google/google.js';
import type { ConnexionDeps } from '../connexions/service.js';
import { entreprises } from '../crm/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { titreVisio } from './nomenclature.js';

export class EntrepriseIntrouvable extends Error {
  constructor() {
    super('Entreprise introuvable');
  }
}

export const visioSchema = z
  .object({
    entrepriseId: z.uuid(),
    motif: z.string().trim().max(120).nullish(),
    debut: rdvOsSchema.shape.debut,
    dureeMinutes: rdvOsSchema.shape.dureeMinutes,
    invites: z.array(z.string().trim().toLowerCase().pipe(z.email())).max(30).default([]),
  })
  .strict();

export type SaisieVisio = z.infer<typeof visioSchema>;
export type DepsVisio = ConnexionDeps & GoogleOptions & { hote: string };

// Rendez-vous de l'OS nommé selon la nomenclature, avec lien Meet et invitations par l'agenda
// Google. Sans le double verrou d'écriture, tout reste en simulation : aucune invitation ne part.
export async function creerVisio(
  db: Executor,
  instance: Instance,
  saisie: SaisieVisio,
  deps: DepsVisio,
): Promise<{
  id: string;
  ligneId: string;
  titre: string;
  lienVisio: string | null;
  google: CopieAgenda;
}> {
  return withInstance(db, instance.id, async (tx) => {
    const [entreprise] = await tx
      .select({ nom: entreprises.nom })
      .from(entreprises)
      .where(
        and(eq(entreprises.instanceId, currentInstance), eq(entreprises.id, saisie.entrepriseId)),
      );
    if (!entreprise) throw new EntrepriseIntrouvable();
    const titre = titreVisio({ entreprise: entreprise.nom, hote: deps.hote, motif: saisie.motif });
    const cree = await creerRendezVousDansTx(
      tx,
      instance,
      {
        titre,
        debut: saisie.debut,
        dureeMinutes: saisie.dureeMinutes,
        visio: true,
        invites: saisie.invites,
      },
      {
        secretsDir: deps.secretsDir,
        realWrites: deps.realWrites,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      },
    );
    return { ...cree, titre };
  });
}
