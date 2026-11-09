import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { listInstances } from '../instances/service.js';
import { envoyerInvitation } from './invitations.js';
import type { ReleveVmaDeps } from './releve.js';
import { vmaTests } from './schema.js';

const inscriptionSchema = z.object({
  invitation: z.string().regex(/^[0-9a-f]{32}$/),
  entreprise: z.string().trim().min(1).max(160),
  prenom: z.string().trim().min(1).max(80),
  nom: z.string().trim().min(1).max(120),
  poste: z.string().trim().min(1).max(120),
  // Même validation que le formulaire : une adresse acceptée par le site ne bloque pas la relève.
  email: z
    .string()
    .max(200)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  telephone: z.string().max(40).nullable(),
  creeLe: z.iso.datetime({ offset: true }),
  expireLe: z.iso.datetime({ offset: true }),
  consentement: z.object({
    accepteLe: z.iso.datetime({ offset: true }),
    version: z.string().min(1).max(80),
    texte: z.string().min(1).max(1000),
  }),
});

// L'invitation est conservée avant l'acquittement. Une relève rejouée ne recrée ni ligne ni mail.
// Les envois en échec restent visibles et sont repris au prochain passage.
export async function releverInscriptionsVma(db: Database, deps: ReleveVmaDeps): Promise<number> {
  const http = deps.fetch ?? fetch;
  const base = deps.url.replace(/\/+$/, '');
  const headers = { authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' };
  const res = await http(`${base}/api/test-vma/inscriptions`, { headers });
  // Déploiement progressif : les sites antérieurs n'ont pas encore cet endpoint.
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`Site : lecture des inscriptions refusée (${res.status})`);
  const { inscriptions } = z
    .object({ inscriptions: z.array(inscriptionSchema) })
    .parse(await res.json());
  const propre = (await listInstances(db)).find((i) => i.type === 'propre');
  if (!propre) {
    if (inscriptions.length)
      throw new Error('Aucune instance « Mon activité » pour les inscriptions VMA');
    return 0;
  }
  for (const r of inscriptions) {
    await withInstance(db, propre.id, (tx) =>
      tx
        .insert(vmaTests)
        .values({
          instanceId: propre.id,
          origine: 'inscription',
          entrepriseNom: r.entreprise,
          contactPrenom: r.prenom,
          contactNomFamille: r.nom,
          contactNom: `${r.prenom} ${r.nom}`,
          contactPoste: r.poste,
          contactEmail: r.email,
          contactTelephone: r.telephone,
          consentement: r.consentement,
          type: 'premier',
          invitationId: r.invitation,
          lien: `${base}/test-vma?i=${r.invitation}`,
          expireLe: new Date(r.expireLe),
          createdAt: new Date(r.creeLe),
        })
        .onConflictDoNothing({ target: vmaTests.invitationId }),
    );
  }
  if (inscriptions.length) {
    const ack = await http(`${base}/api/test-vma/inscriptions`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ ids: inscriptions.map((r) => r.invitation) }),
    });
    if (!ack.ok) throw new Error(`Site : acquittement des inscriptions refusé (${ack.status})`);
  }
  if (deps.ecriture) {
    const enAttente = await withInstance(db, propre.id, (tx) =>
      tx
        .select()
        .from(vmaTests)
        .where(
          and(
            eq(vmaTests.instanceId, propre.id),
            eq(vmaTests.origine, 'inscription'),
            eq(vmaTests.statut, 'envoyee'),
            isNull(vmaTests.envoyeeLe),
            gt(vmaTests.expireLe, new Date()),
          ),
        ),
    );
    for (const test of enAttente) await envoyerInvitation(db, propre, deps.ecriture, test);
  }
  return inscriptions.length;
}
